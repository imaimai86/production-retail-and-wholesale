import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, PendingItem, Question, Run, RunState, Snapshot } from '../types'

const PANE = 'sdlc'
const EVERY_MS = 2000
const PENDING_EVERY_MS = 10000
const CAP = 2
const WRAPPER = 'scripts/sdlc-mod.sh'
// The stage names status.json carries (scripts/sdlc.sh strips the numbering).
const STAGES = ['Spec', 'Plan', 'Red tests', 'Implement', 'Test repair', 'Review', 'Commit']
// How long the Start button stays a "Starting…" note while the wrapper creates the worktree.
const LAUNCH_GRACE_MS = 20000
const RESUME_AT_IMPLEMENT = ['Implement', 'Test repair', 'Review', 'Commit']

const EMPTY: Snapshot = { now: 0, runs: [], pending: [], discarded: {} }
const snapshot = atom({ plugin: 'sdlc-monitor', key: 'snapshot' } as const, EMPTY)
const agents = atom({ plugin: 'sdlc-monitor', key: 'agents' } as const, {} as Record<string, AgentRow>)
const view = atom({ plugin: 'sdlc-monitor', key: 'view' } as const, '')
const selected = atom({ plugin: 'sdlc-monitor', key: 'selected' } as const, {} as Record<string, boolean>)
const queue = atom({ plugin: 'sdlc-monitor', key: 'queue' } as const, [] as string[])
const confirmStop = atom({ plugin: 'sdlc-monitor', key: 'confirmStop' } as const, '')
const confirmDiscard = atom({ plugin: 'sdlc-monitor', key: 'confirmDiscard' } as const, '')
const launching = atom({ plugin: 'sdlc-monitor', key: 'launching' } as const, {} as Record<string, number>)
const draft = atom({ plugin: 'sdlc-monitor', key: 'draft' } as const, {} as Record<string, string>)
const notice = atom({ plugin: 'sdlc-monitor', key: 'notice' } as const, '')

const GLYPH: Record<RunState, string> = { starting: '◌', running: '●', paused: '⏸', done: '✔', failed: '✘', interrupted: '■', stopped: '✘' }
const COLOR: Record<RunState, string> = { starting: 'cyan', running: 'cyan', paused: 'yellow', done: 'green', failed: 'red', interrupted: 'yellow', stopped: 'red' }
const ORDER: Record<RunState, number> = { running: 0, paused: 1, starting: 2, failed: 3, stopped: 3, interrupted: 3, done: 4 }

type StageState = 'done' | 'active' | 'failed' | 'paused' | 'pending'
const STAGE_GLYPH: Record<StageState, string> = { done: '✔', active: '●', failed: '✘', paused: '⏸', pending: '○' }
const STAGE_COLOR: Record<StageState, string> = { done: 'green', active: 'cyan', failed: 'red', paused: 'yellow', pending: 'gray' }

const bar = (done: number, total: number, width: number) => {
  const filled = total ? Math.round((width * done) / total) : 0

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const parse = (text: string | null): Record<string, unknown> | null => {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// questions.md as the Spec agent writes it: "### Q<n>: <title>", a body, "**Suggested:** ...", "**Answer:**".
function parseQuestions(text: string): Question[] {
  const out: Question[] = []
  let q: Question | null = null
  let part: 'body' | 'suggested' | 'answer' = 'body'
  for (const line of text.split('\n')) {
    const head = line.match(/^### Q(\d+):\s*(.*)$/)
    if (head) {
      q = { n: Number(head[1]), title: head[2].trim(), body: '', suggested: '' }
      out.push(q)
      part = 'body'
    } else if (q) {
      if (/^\*\*Suggested:\*\*/.test(line)) {
        part = 'suggested'
        q.suggested = line.replace(/^\*\*Suggested:\*\*\s*/, '')
      } else if (/^\*\*Answer:\*\*/.test(line)) {
        part = 'answer'
      } else if (part === 'body') {
        q.body = `${q.body}${q.body ? ' ' : ''}${line.trim()}`.trim()
      } else if (part === 'suggested' && line.trim()) {
        q.suggested = `${q.suggested} ${line.trim()}`
      }
    }
  }

  return out
}

// Puts each answer on its "**Answer:**" line, in question order.
function fillAnswers(text: string, answers: Record<number, string>): string {
  let n = 0

  return text
    .split('\n')
    .map(line => {
      const head = line.match(/^### Q(\d+):/)
      if (head) n = Number(head[1])

      return /^\*\*Answer:\*\*/.test(line) && answers[n] ? `**Answer:** ${answers[n]}` : line
    })
    .join('\n')
}

function testCounts(log: string | null): Run['tests'] {
  const m = (log ?? '').match(/^Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(?:(\d+) passed, )?(\d+) total/m)

  return m ? { failed: Number(m[1] ?? 0), passed: Number(m[3] ?? 0), total: Number(m[4]) } : null
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return (await $.fs.read(path)) as string
  } catch {
    return null
  }
}

async function names($: EngineInterface, path: string): Promise<{ name: string; kind: string }[]> {
  try {
    return await $.fs.list(path)
  } catch {
    return []
  }
}

async function isAlive($: EngineInterface, pid: number): Promise<boolean> {
  if (!pid) return false
  try {
    return (await $.process.run(['kill', '-0', String(pid)])).exitCode === 0
  } catch {
    return false
  }
}

let commonDir = ''
let pendingAt = 0
let pendingCache: PendingItem[] = []

// Where sdlc-mod.sh keeps its run records: one folder shared by every worktree.
async function registryDir($: EngineInterface): Promise<string> {
  if (!commonDir) {
    try {
      commonDir = (await $.process.run(['git', 'rev-parse', '--git-common-dir'])).stdout.trim() || '.git'
    } catch {
      commonDir = '.git'
    }
  }

  return `${commonDir}/sdlc-runs`
}

async function loadPending($: EngineInterface, now: number): Promise<PendingItem[]> {
  if (now - pendingAt < PENDING_EVERY_MS && pendingAt) return pendingCache
  try {
    const r = await $.process.run(['node', 'scripts/backlog-list.cjs', 'pending', '--json'])
    const rows = JSON.parse(r.stdout) as { slug: string; type: string | null; priority: string | null; title: string }[]
    pendingCache = rows.map(x => ({ slug: x.slug, type: x.type ?? '-', priority: x.priority ?? '-', title: x.title }))
  } catch {
    pendingCache = []
  }
  pendingAt = now

  return pendingCache
}

// One pipeline: the wrapper's record, the pipeline's own status.json, and what it has written so far.
async function loadRun($: EngineInterface, slug: string, worktree: string, reg: Record<string, unknown> | null): Promise<Run> {
  const root = worktree || '.'
  const docs = `${root}/Docs/backlog/${slug}`
  const status = parse(await readText($, `${docs}/logs/status.json`))
  const files = [
    ...(await names($, docs)).filter(f => f.kind === 'file').map(f => f.name),
    ...(await names($, `${docs}/logs`)).filter(f => /^(impl|spec)-\d+\.log$/.test(f.name)).map(f => f.name),
  ]
  const runOut = (await readText($, `${docs}/logs/run.out`)) ?? ''
  const questionsText = await readText($, `${docs}/questions.md`)
  const pid = Number(reg?.pid ?? status?.pid ?? 0)
  const alive = await isAlive($, pid)

  let state: RunState
  if (reg?.interrupted === true) state = 'interrupted'
  else if (status?.state === 'done') state = 'done'
  else if (status?.state === 'paused') state = 'paused'
  else if (status?.state === 'failed') state = 'failed'
  else if (status?.state === 'running') state = alive ? 'running' : 'stopped'
  else if (reg?.state === 'running' && alive) state = 'starting'
  else if (reg?.state === 'exited' && reg.exit_code !== '0' && reg.exit_code !== '2') state = 'failed'
  else state = alive ? 'starting' : 'stopped'

  return {
    slug,
    worktree: root,
    state,
    stage: String(status?.stage ?? ''),
    agent: String(status?.agent ?? ''),
    attempt: String(status?.attempt ?? ''),
    agentStarted: String(status?.agent_started ?? ''),
    runStarted: String(status?.run_started ?? reg?.started ?? ''),
    updated: String(status?.updated ?? ''),
    pid,
    files,
    tests: testCounts(await readText($, `${docs}/logs/tests.log`)),
    tail: runOut.split('\n').filter(l => l.trim()).slice(-8),
    questions: questionsText ? parseQuestions(questionsText) : [],
    managed: reg !== null,
    message: String(reg?.message ?? ''),
  }
}

async function collect($: EngineInterface): Promise<Snapshot> {
  const now = await $.clock.now()
  const dir = await registryDir($)
  const runs: Run[] = []
  const seen = new Set<string>()

  const discarded: Record<string, string> = {}
  for (const f of await names($, dir)) {
    if (f.kind === 'file' && f.name.endsWith('.discarded')) {
      discarded[f.name.replace(/\.discarded$/, '')] = ((await readText($, `${dir}/${f.name}`)) ?? '').trim()
      continue
    }
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const reg = parse(await readText($, `${dir}/${f.name}`))
    if (!reg || typeof reg.slug !== 'string') continue
    seen.add(reg.slug)
    runs.push(await loadRun($, reg.slug, String(reg.worktree ?? ''), reg))
  }
  // A pipeline started by hand with scripts/sdlc.sh in this working tree has no record: find it by its status file.
  for (const d of await names($, 'Docs/backlog')) {
    if (d.kind === 'dir' && !seen.has(d.name) && (await readText($, `Docs/backlog/${d.name}/logs/status.json`))) {
      runs.push(await loadRun($, d.name, '', null))
    }
  }
  runs.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updated.localeCompare(a.updated))

  return { now, runs, pending: await loadPending($, now), discarded }
}

// Starts (or resumes) a pipeline in the background: it outlives this pane and this session.
async function launch($: EngineInterface, slug: string, from: string) {
  const env: Record<string, string> = { SDLC_MAX_PARALLEL: String(CAP) }
  if (from) env.FROM = from
  await $.process.run(['bash', '-c', `nohup bash ${WRAPPER} run "$0" </dev/null >/dev/null 2>&1 &`, slug], { env })
}

async function stopRun($: EngineInterface, slug: string) {
  await $.process.run(['bash', WRAPPER, 'stop', slug])
}

// Stops the pipeline if it runs, then deletes its worktree, branch and run record (the branch tip is saved).
async function discardRun($: EngineInterface, slug: string) {
  await $.process.run(['bash', WRAPPER, 'discard', slug, '--yes', '--stop'])
}

async function startRun($: EngineInterface, slug: string) {
  const now = await $.clock.now()
  await update($, launching, l => ({ ...l, [slug]: now }))
  await launch($, slug, '')
}

const resumeFrom = (run: Run) => (RESUME_AT_IMPLEMENT.includes(run.stage) ? 'implement' : '')

async function refresh($: EngineInterface) {
  const s = await collect($)
  await update($, snapshot, () => s)
  const pressed = await read($, launching)
  const left = Object.fromEntries(Object.entries(pressed).filter(([k]) => !s.runs.some(r => r.slug === k)))
  if (Object.keys(left).length !== Object.keys(pressed).length) await update($, launching, () => left)

  return s
}

// Starts as many of the selected items as the cap allows; the rest wait in the queue.
async function runSelected($: EngineInterface) {
  const pick = await read($, selected)
  const slugs = Object.keys(pick).filter(k => pick[k])
  if (!slugs.length) return
  const s = await read($, snapshot)
  const running = s.runs.filter(r => r.state === 'running' || r.state === 'starting').length
  const free = Math.max(0, CAP - running)
  for (const slug of slugs.slice(0, free)) await launch($, slug, '')
  await update($, queue, q => [...q, ...slugs.slice(free).filter(x => !q.includes(x))])
  await update($, selected, () => ({}))
  await update($, notice, () => `Started ${Math.min(free, slugs.length)}, queued ${Math.max(0, slugs.length - free)} (at most ${CAP} run at once).`)
  await refresh($)
}

// Starts queued items whenever a slot is free.
async function drainQueue($: EngineInterface, s: Snapshot) {
  const waiting = await read($, queue)
  if (!waiting.length) return
  const running = s.runs.filter(r => r.state === 'running' || r.state === 'starting').length
  if (running >= CAP) return
  const next = waiting[0]
  await update($, queue, q => q.filter(x => x !== next))
  await launch($, next, '')
}

async function submitAnswers($: EngineInterface, run: Run) {
  const drafts = await read($, draft)
  const path = `${run.worktree}/Docs/backlog/${run.slug}/questions.md`
  const text = await readText($, path)
  if (!text) return
  const answers: Record<number, string> = {}
  for (const q of run.questions) answers[q.n] = drafts[`${run.slug}:${q.n}`] ?? ''
  await $.fs.write(path, fillAnswers(text, answers))
  await update($, draft, d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${run.slug}:`))))
  await launch($, run.slug, '')
  await update($, notice, () => `Answers saved, ${run.slug} resumed.`)
  await refresh($)
}

function stageStates(run: Run): { name: string; state: StageState }[] {
  const isGone = run.state === 'stopped'
  const at = STAGES.indexOf(run.stage)
  const wasRepaired = run.files.includes('test-repair-1.md')

  return STAGES.map((name, i): { name: string; state: StageState } => {
    if (run.state === 'done' || i < at) return { name, state: 'done' }
    if (at < 0 || i > at) return { name, state: 'pending' }
    if (run.state === 'paused') return { name, state: 'paused' }

    return { name, state: run.state === 'failed' || run.state === 'interrupted' || isGone ? 'failed' : 'active' }
  }).filter(st => st.name !== 'Test repair' || st.state === 'active' || st.state === 'failed' || wasRepaired)
}

const summary = (runs: Run[], queued: number) => {
  const n = (state: RunState) => runs.filter(r => r.state === state).length
  const parts = [`${n('running') + n('starting')} running`, `${n('paused')} paused`]
  if (queued) parts.push(`${queued} queued`)

  return parts.join(' · ')
}

const oneLine = (run: Run, now: number) => {
  if (run.state === 'running') return `${run.stage || 'Starting'} · ${run.agent || '…'} · ${clock(now - Date.parse(run.agentStarted))}${run.attempt ? ` · attempt ${run.attempt}` : ''}`
  if (run.state === 'paused') return `needs answers: ${run.questions.length} question${run.questions.length === 1 ? '' : 's'}`
  if (run.state === 'done') return 'done'
  if (run.state === 'interrupted') return `interrupted at ${run.stage || 'start'}`
  if (run.state === 'stopped') return `stopped (process gone) at ${run.stage || 'start'}`
  if (run.state === 'failed') return run.message ? `failed: ${run.message}` : `failed at ${run.stage || 'start'}`

  return 'starting'
}

async function sweepAgents($: EngineInterface) {
  let list: Awaited<ReturnType<EngineInterface['agent']['list']>> = []
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  await update($, agents, rows => {
    const next = { ...rows }
    for (const a of list) {
      const was = next[a.id]
      next[a.id] = {
        id: a.id,
        label: a.name ?? (a.description || a.type),
        status: String(a.status),
        tools: was?.tools ?? 0,
        lastTool: was?.lastTool ?? '',
        tokens: was?.tokens ?? 0,
      }
    }

    return next
  })
}

let previous: Record<string, RunState> = {}
let isFirst = true

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sdlc-monitor', description: 'Open the SDLC control pane: start, watch, answer and stop pipelines' })
    $.clock.every(EVERY_MS, async () => {
      const s = await refresh($)
      await drainQueue($, s)
      await sweepAgents($)
      const now: Record<string, RunState> = {}
      for (const r of s.runs) {
        now[r.slug] = r.state
        if (!isFirst && previous[r.slug] && previous[r.slug] !== r.state) {
          if (r.state === 'paused') $.ui.toast(`${r.slug} is paused: ${r.questions.length} question(s) need answers`)
          else if (r.state === 'failed' || r.state === 'stopped') $.ui.toast(`${r.slug} failed at ${r.stage || 'start'}`)
          else if (r.state === 'done') $.ui.toast(`${r.slug} is done`)
        }
      }
      previous = now
      isFirst = false
      const q = await read($, queue)
      const active = s.runs.filter(r => r.state === 'running' || r.state === 'starting' || r.state === 'paused')
      $.ui.status(active.length || q.length ? `sdlc ${summary(s.runs, q.length)}` : undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'sdlc-monitor' }, async $ => {
    await refresh($)
    await sweepAgents($)
    await $.ui.open({ id: PANE, title: 'SDLC control' })
    const s = await read($, snapshot)

    return { text: `SDLC control opened: ${summary(s.runs, 0)}, ${s.pending.length} pending.` }
  })

  // Per-agent tool counts, for the session's own subagents (a headless `claude -p` stage is a separate process).
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, rows => {
        const was = rows[id] ?? { id, label: id.slice(0, 8), status: 'running', tools: 0, lastTool: '', tokens: 0 }

        return { ...rows, [id]: { ...was, tools: was.tools + 1, lastTool: e.tool } }
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage

    if (e.agentId && u) {
      const id = e.agentId
      await update($, agents, rows => {
        const was = rows[id] ?? { id, label: id.slice(0, 8), status: 'running', tools: 0, lastTool: '', tokens: 0 }

        return { ...rows, [id]: { ...was, tokens: was.tokens + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens } }
      })
    }

    return next(e)
  })

  // The always-visible entry point: one button above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const q = await read($, queue)
    const live = s.runs.filter(r => r.state === 'running' || r.state === 'starting' || r.state === 'paused')

    return (
      <Box gap={1}>
        <Button key="sdlc-open" label="SDLC" variant="primary" onPress={() => $.ui.open({ id: PANE, title: 'SDLC control' })} />
        <Text dimColor>{live.length || q.length ? summary(s.runs, q.length) : `${s.pending.length} pending`}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const current = await read($, view)
    const run = s.runs.find(r => r.slug === current)

    if (!run && !current) {
      const pick = await read($, selected)
      const waiting = await read($, queue)
      const message = await read($, notice)
      const rows = Object.values(await read($, agents))
      const chosen = Object.keys(pick).filter(k => pick[k]).length
      const running = s.runs.filter(r => r.state === 'running' || r.state === 'starting').length

      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Text bold>
            SDLC control <Text dimColor> {summary(s.runs, waiting.length)} · up to {CAP} at once</Text>
          </Text>
          {message && <Text color="cyan">{message}</Text>}

          <Box flexDirection="column">
            <Text bold>Pending ({s.pending.length}): select one or more</Text>
            {s.pending.length === 0 && <Text dimColor>Nothing pending in Docs/backlog/index.md.</Text>}
            {s.pending.map(p => {
              const isOn = pick[p.slug] === true
              const isBusy = s.runs.some(r => r.slug === p.slug && (r.state === 'running' || r.state === 'starting' || r.state === 'paused')) || waiting.includes(p.slug)

              return (
                <Box key={`row-${p.slug}`} gap={1}>
                  <Button
                    key={`sel-${p.slug}`}
                    plain
                    label={`${isOn ? '[x]' : '[ ]'} ${p.slug}`}
                    onPress={() => update($, selected, m => ({ ...m, [p.slug]: !m[p.slug] }))}
                  />
                  <Text dimColor>
                    {p.type} {p.priority}
                  </Text>
                  <Text>{cut(p.title, 56)}</Text>
                  {isBusy && <Text color="yellow">already started</Text>}
                </Box>
              )
            })}
            <Box gap={1}>
              <Button key="run-selected" label={`Run selected (${chosen})`} variant="primary" onPress={() => runSelected($)} />
              <Button key="clear-selected" label="Clear" onPress={() => update($, selected, () => ({}))} />
              <Text dimColor>{running >= CAP ? 'both slots busy: extra items will queue' : `${CAP - running} slot(s) free`}</Text>
            </Box>
          </Box>

          <Box flexDirection="column">
            <Text bold>Pipelines</Text>
            {s.runs.length === 0 && <Text dimColor>None yet. Select items above and press Run selected.</Text>}
            {s.runs.map(r => (
              <Box key={`run-${r.slug}`} gap={1} flexWrap="wrap">
                <Text color={COLOR[r.state]} bold={r.state === 'paused'}>
                  {GLYPH[r.state]} {r.slug}
                </Text>
                <Text dimColor>{oneLine(r, s.now)}</Text>
                <Button key={`open-${r.slug}`} label={r.state === 'paused' ? 'Answer' : 'Open'} variant={r.state === 'paused' ? 'primary' : undefined} onPress={() => update($, view, () => r.slug)} />
              </Box>
            ))}
            {waiting.map(slug => (
              <Text key={`queued-${slug}`} dimColor>
                ◌ {slug} queued
              </Text>
            ))}
          </Box>

          {rows.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Subagents of this session</Text>
              {rows.slice(0, 6).map(r => (
                <Text key={r.id} dimColor>
                  {r.label} · {r.status} · {r.tools} tools{r.lastTool ? ` (${r.lastTool})` : ''} · {r.tokens.toLocaleString()} tok
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    // An item with no pipeline: never started, or just discarded.
    if (!run) {
      const item = s.pending.find(p => p.slug === current)
      const saved = s.discarded[current] ?? ''
      const pressedAt = (await read($, launching))[current]
      const isStarting = pressedAt !== undefined && s.now - pressedAt < LAUNCH_GRACE_MS

      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Box gap={1} flexWrap="wrap">
            <Button key="back" label="← All pipelines" onPress={() => update($, view, () => '')} />
            {isStarting ? (
              <Text color="cyan">◌ Starting…</Text>
            ) : (
              <Button key="start" label="Start" variant="primary" onPress={() => startRun($, current)} />
            )}
          </Box>
          <Text bold>
            {current}  <Text dimColor>not started</Text>
          </Text>
          {item && (
            <Text dimColor>
              {item.type} {item.priority} · {cut(item.title, 80)}
            </Text>
          )}
          {saved && <Text dimColor>Discarded. To get the old branch back: {saved}</Text>}
        </Box>
      )
    }

    // One pipeline in detail.
    const drafts = await read($, draft)
    const stopping = (await read($, confirmStop)) === run.slug
    const discarding = (await read($, confirmDiscard)) === run.slug
    const stages = stageStates(run)
    const done = stages.filter(x => x.state === 'done').length
    const since = run.agentStarted ? s.now - Date.parse(run.agentStarted) : 0
    const [tryNo, tryMax] = run.attempt.split('/').map(Number)
    const impls = run.files.filter(f => /^impl-\d+\.log$/.test(f)).length
    const answered = run.questions.filter(q => drafts[`${run.slug}:${q.n}`]).length
    const canStop = run.managed && (run.state === 'running' || run.state === 'starting')
    const canDiscard = run.managed
    const canResume = run.managed && (run.state === 'failed' || run.state === 'interrupted' || run.state === 'stopped')

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box gap={1} flexWrap="wrap">
          <Button key="back" label="← All pipelines" onPress={() => update($, view, () => '')} />
          {canStop && (
            <Button
              key="stop"
              label={stopping ? 'Confirm stop' : 'Stop'}
              variant={stopping ? 'primary' : undefined}
              onPress={async () => {
                if (stopping) {
                  await stopRun($, run.slug)
                  await update($, confirmStop, () => '')
                  await refresh($)
                } else {
                  await update($, confirmStop, () => run.slug)
                }
              }}
            />
          )}
          {stopping && <Button key="cancel-stop" label="Keep running" onPress={() => update($, confirmStop, () => '')} />}
          {canResume && (
            <Button
              key="resume"
              label={resumeFrom(run) ? 'Resume from Implement' : 'Resume'}
              variant="primary"
              onPress={async () => {
                await launch($, run.slug, resumeFrom(run))
                await refresh($)
              }}
            />
          )}
          {canDiscard && (
            <Button
              key="discard"
              label={discarding ? 'Confirm discard' : 'Discard'}
              variant={discarding ? 'primary' : undefined}
              onPress={async () => {
                if (discarding) {
                  await update($, confirmDiscard, () => '')
                  await update($, confirmStop, () => '')
                  await update($, draft, d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${run.slug}:`))))
                  await discardRun($, run.slug)
                  await update($, notice, () => `Discarded ${run.slug}.`)
                  await refresh($)
                } else {
                  await update($, confirmDiscard, () => run.slug)
                }
              }}
            />
          )}
          {discarding && <Button key="cancel-discard" label="Keep it" onPress={() => update($, confirmDiscard, () => '')} />}
        </Box>

        {discarding && (
          <Text color="yellow">
            This deletes the worktree and branch sdlc/{run.slug} (unpushed work is lost; the branch tip is saved so it can be recovered). A running pipeline is stopped first.
          </Text>
        )}
        {!run.managed && (
          <Text color="yellow">Started outside the wrapper, so Stop and Resume are not available here. Resume it in the main working tree with ./scripts/sdlc.sh {run.slug}.</Text>
        )}
        {run.message && <Text color="red">{run.message}</Text>}

        <Box flexDirection="column">
          <Text bold>
            {run.slug}  <Text color={COLOR[run.state]}>{run.state === 'stopped' ? 'stopped (process gone)' : run.state}</Text>
          </Text>
          <Text>
            {bar(done, stages.length, 30)} {done}/{stages.length} stages
          </Text>
        </Box>

        <Box flexWrap="wrap" gap={1}>
          {stages.map(st => (
            <Box key={`stage-${st.name}`} borderStyle="round" borderColor={STAGE_COLOR[st.state]} paddingX={1}>
              <Text color={STAGE_COLOR[st.state]} bold={st.state === 'active'} dimColor={st.state === 'pending'}>
                {STAGE_GLYPH[st.state]} {st.name}
              </Text>
            </Box>
          ))}
        </Box>

        {run.state === 'running' && run.agent && (
          <Box flexDirection="column">
            <Text bold>Agent</Text>
            <Text>
              <Text color="cyan">{run.agent}</Text>
              <Text dimColor>  running {clock(since)}</Text>
            </Text>
            {tryMax > 0 && (
              <Text>
                attempt {bar(tryNo, tryMax, tryMax * 3)} {tryNo}/{tryMax}
              </Text>
            )}
          </Box>
        )}

        {run.tests && (
          <Text>
            Tests {bar(run.tests.passed, run.tests.total, 24)} {run.tests.passed}/{run.tests.total} passing
            {run.tests.failed ? <Text color="red">  {run.tests.failed} failing</Text> : null}
          </Text>
        )}

        <Text>
          {['specs-1.md', 'plan-1.md', 'test-cases-1.md', 'review-1.md'].map(f => `${run.files.includes(f) ? '✔' : '○'} ${f.replace('-1.md', '')}`).join('   ')}
          {impls ? `   ⟳ impl ×${impls}` : ''}
        </Text>

        {run.state === 'paused' && run.questions.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text bold color="yellow">
              {answered}/{run.questions.length} questions answered
            </Text>
            {run.questions.map(q => {
              const key = `${run.slug}:${q.n}`

              return (
                <Box key={`q-${q.n}`} flexDirection="column">
                  <Text bold>
                    Q{q.n}: {q.title}
                  </Text>
                  {q.body && <Text dimColor>{q.body}</Text>}
                  <Text>
                    Suggested: <Text color="green">{q.suggested}</Text>
                  </Text>
                  <Box gap={1} flexWrap="wrap">
                    <Button key={`use-${key}`} label="Use suggested" onPress={() => update($, draft, d => ({ ...d, [key]: 'accept' }))} />
                    <Input
                      key={`ans-${key}`}
                      placeholder="or type your own answer, then Enter"
                      onSubmit={value => update($, draft, d => ({ ...d, [key]: value.trim() }))}
                    />
                  </Box>
                  {drafts[key] && (
                    <Text color="cyan">
                      → {drafts[key] === 'accept' ? 'accept suggested' : drafts[key]}
                    </Text>
                  )}
                </Box>
              )
            })}
            {answered === run.questions.length ? (
              <Button key="submit-answers" label="Submit answers and resume" variant="primary" onPress={() => submitAnswers($, run)} />
            ) : (
              <Text dimColor>Answer every question to resume.</Text>
            )}
          </Box>
        )}
        {run.state === 'paused' && run.questions.length === 0 && <Text color="yellow">Paused, but questions.md has no questions I can read: open Docs/backlog/{run.slug}/questions.md.</Text>}

        <Box flexDirection="column">
          <Text bold>Recent output</Text>
          {run.tail.length === 0 && <Text dimColor>No output yet.</Text>}
          {run.tail.map((line, i) => (
            <Text key={`tail-${i}`} dimColor>
              {cut(line, 100)}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

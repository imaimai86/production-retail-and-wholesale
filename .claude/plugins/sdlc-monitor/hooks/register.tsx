import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, ConfigForm, ConfigProvider, PendingItem, Question, Run, RunState, Snapshot } from '../types'

const PANE = 'sdlc'
const CONFIG_PANE = 'config'
const EVERY_MS = 2000
const PENDING_EVERY_MS = 10000
const CAP = 2
const WRAPPER = 'scripts/sdlc-mod.sh'
// How often the file counts of a pipeline that is not running are recomputed.
const CHANGES_EVERY_MS = 10000
// The stage names status.json carries (scripts/sdlc.sh strips the numbering).
const STAGES = ['Spec', 'Plan', 'Red tests', 'Implement', 'Test repair', 'Review', 'Commit']
// How long the Start button stays a "Starting…" note while the wrapper creates the worktree.
const LAUNCH_GRACE_MS = 20000
// Agent stages that take a manual input: the FROM value that resumes at the stage, and the "## <key>" section of manual-inputs.md.
const INPUT_STAGES = [
  { key: 'spec', label: 'Spec' },
  { key: 'plan', label: 'Plan' },
  { key: 'red-tests', label: 'Red tests' },
  { key: 'implement', label: 'Implement' },
  { key: 'review', label: 'Review' },
]
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
// What a button press is working on ('' when idle), and the spinner frame drawn beside it.
const busy = atom({ plugin: 'sdlc-monitor', key: 'busy' } as const, '')
const frame = atom({ plugin: 'sdlc-monitor', key: 'frame' } as const, 0)
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN_MS = 250
const EMPTY_FORM: ConfigForm = { provider: '', endpoint: '', keyEnv: '', models: '', effort: false }
const CONFIG_FIELDS: { key: 'provider' | 'endpoint' | 'keyEnv' | 'models'; label: string }[] = [
  { key: 'provider', label: 'provider name (saved in lowercase)' },
  { key: 'endpoint', label: 'endpoint' },
  { key: 'keyEnv', label: 'API key variable NAME (not the key)' },
  { key: 'models', label: 'models (comma list)' },
]
const configList = atom({ plugin: 'sdlc-monitor', key: 'configList' } as const, null as Record<string, ConfigProvider> | null)
const configError = atom({ plugin: 'sdlc-monitor', key: 'configError' } as const, '')
const configForm = atom({ plugin: 'sdlc-monitor', key: 'configForm' } as const, EMPTY_FORM)
// 'list' is the provider list; 'form' is the add / edit form. configEditing is the provider being edited, '' for a new one.
const configView = atom({ plugin: 'sdlc-monitor', key: 'configView' } as const, 'list' as 'list' | 'form')
const configEditing = atom({ plugin: 'sdlc-monitor', key: 'configEditing' } as const, '')
const configConfirmProvider = atom({ plugin: 'sdlc-monitor', key: 'configConfirmProvider' } as const, '')
const configConfirmModel = atom({ plugin: 'sdlc-monitor', key: 'configConfirmModel' } as const, null as { provider: string; model: string } | null)

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

// Returns manual-inputs.md with the "## <key>" section set to value (an empty value removes it).
function setManualInput(text: string, key: string, value: string): string {
  const sections: Record<string, string> = {}
  let cur = ''
  for (const line of text.split('\n')) {
    const head = line.match(/^## (\S+)\s*$/)
    if (head) {
      cur = head[1]
      sections[cur] = ''
    } else if (cur) sections[cur] += `${line}\n`
  }
  sections[key] = `${value.trim()}\n`

  return INPUT_STAGES.filter(st => (sections[st.key] ?? '').trim())
    .map(st => `## ${st.key}\n${sections[st.key].trim()}\n`)
    .join('\n')
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

// Files a pipeline has changed, counted by the wrapper inside the pipeline's own worktree. A pipeline started by hand has
// no record, so its changes cannot be told apart from the developer's own work: no counts. A running, paused or starting
// pipeline is counted on every refresh; a finished one at most every CHANGES_EVERY_MS (the last result, null included, is reused).
const LIVE: RunState[] = ['running', 'paused', 'starting']
const changesCache = new Map<string, { at: number; value: Run['changes'] }>()

async function loadChanges($: EngineInterface, slug: string, state: RunState, managed: boolean, now: number): Promise<Run['changes']> {
  if (!managed) return null
  const hit = changesCache.get(slug)
  if (!LIVE.includes(state) && hit && now - hit.at < CHANGES_EVERY_MS) return hit.value
  let value: Run['changes'] = null
  try {
    const r = await $.process.run(['bash', WRAPPER, 'changes', slug, '--json'])
    if (r.exitCode === 0) {
      const j = JSON.parse(r.stdout) as { changed?: unknown; uncommitted?: unknown }
      if (typeof j.changed === 'number' && typeof j.uncommitted === 'number') value = { changed: j.changed, uncommitted: j.uncommitted }
    }
  } catch {
    value = null
  }
  changesCache.set(slug, { at: now, value })

  return value
}

// Why a stage failed: the last lines of that stage's own log (plan.log, review.log, the newest spec-N.log or impl-N.log), else of run.out.
async function failureReason($: EngineInterface, docs: string, stage: string, runOut: string): Promise<string[]> {
  const logs = (await names($, `${docs}/logs`)).filter(f => f.kind === 'file').map(f => f.name)
  const key = stage.toLowerCase().replace(/[^a-z]/g, '')
  const prefix = key === 'redtests' ? 'red' : key === 'implement' ? 'impl' : key === 'spec' ? 'spec' : key
  const own = logs.filter(f => f === `${prefix}.log` || new RegExp(`^${prefix}-\\d+\\.log$`).test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const text = prefix && own.length ? await readText($, `${docs}/logs/${own[own.length - 1]}`) : null
  const lines = (text ?? runOut).split('\n').filter(l => l.trim())

  return lines.slice(-12)
}

// One pipeline: the wrapper's record, the pipeline's own status.json, and what it has written so far.
async function loadRun($: EngineInterface, slug: string, worktree: string, reg: Record<string, unknown> | null, now: number): Promise<Run> {
  const root = worktree || '.'
  const docs = `${root}/Docs/backlog/${slug}`
  const status = parse(await readText($, `${docs}/logs/status.json`))
  const files = [
    ...(await names($, docs)).filter(f => f.kind === 'file').map(f => f.name),
    ...(await names($, `${docs}/logs`)).filter(f => /^(impl|spec)-\d+\.log$/.test(f.name)).map(f => f.name),
  ]
  const runOut = (await readText($, `${docs}/logs/run.out`)) ?? ''
  const stageName = String(status?.stage ?? '')
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
    model: String(status?.model ?? ''),
    effort: String(status?.effort ?? ''),
    models: (status?.models && typeof status.models === 'object' ? status.models : {}) as Run['models'],
    attempt: String(status?.attempt ?? ''),
    agentStarted: String(status?.agent_started ?? ''),
    runStarted: String(status?.run_started ?? reg?.started ?? ''),
    updated: String(status?.updated ?? ''),
    pid,
    files,
    tests: testCounts(await readText($, `${docs}/logs/tests.log`)),
    tail: runOut.split('\n').filter(l => l.trim()).slice(-8),
    reason: state === 'failed' || state === 'stopped' ? await failureReason($, docs, stageName, runOut) : [],
    questions: questionsText ? parseQuestions(questionsText) : [],
    managed: reg !== null,
    message: String(reg?.message ?? ''),
    changes: await loadChanges($, slug, state, reg !== null, now),
    base: String(reg?.base ?? ''),
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
    runs.push(await loadRun($, reg.slug, String(reg.worktree ?? ''), reg, now))
  }
  // A pipeline started by hand with scripts/sdlc.sh in this working tree has no record: find it by its status file.
  for (const d of await names($, 'Docs/backlog')) {
    if (d.kind === 'dir' && !seen.has(d.name) && (await readText($, `Docs/backlog/${d.name}/logs/status.json`))) {
      runs.push(await loadRun($, d.name, '', null, now))
    }
  }
  runs.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updated.localeCompare(a.updated))

  return { now, runs, pending: await loadPending($, now), discarded }
}

// Starts (or resumes) a pipeline in the background: it outlives this pane and this session.
// Waits 3 seconds: a wrapper that refuses or crashes by then is reported, with the last lines of its output. Returns '' or that error.
const LAUNCH_SCRIPT =
  `out="\${TMPDIR:-/tmp}/sdlc-launch-$0.out"; nohup bash ${WRAPPER} run "$0" </dev/null >"$out" 2>&1 & pid=$!; sleep 3; ` +
  'if ! kill -0 $pid 2>/dev/null; then wait $pid; rc=$?; if [ $rc -ne 0 ] && [ $rc -ne 2 ]; then tail -5 "$out" >&2; echo "exit $rc" >&2; exit $rc; fi; fi'

async function launch($: EngineInterface, slug: string, from: string): Promise<string> {
  const env: Record<string, string> = { SDLC_MAX_PARALLEL: String(CAP) }
  if (from) env.FROM = from
  try {
    const r = await $.process.run(['bash', '-c', LAUNCH_SCRIPT, slug], { env })
    if (r.exitCode === 0) return ''

    return `${slug} did not start: ${(r.stderr || r.stdout || `exit ${r.exitCode}`).trim()}`
  } catch (e) {
    return `${slug} did not start: ${String((e as { message?: string })?.message ?? e)}`
  }
}

// Shows a message in the toast and keeps it in the notice row, which has a Copy button, until it is dismissed.
async function notify($: EngineInterface, text: string) {
  await update($, notice, () => text)
  $.ui.toast(text)
}

// Runs `work` with a loader line (label plus spinner) shown until it ends.
async function withBusy<T>($: EngineInterface, label: string, work: () => Promise<T>): Promise<T> {
  await update($, busy, () => label)
  try {
    return await work()
  } finally {
    await update($, busy, () => '')
  }
}

// Starts or resumes one run and reports a refusal; used by every Start / Resume button.
async function launchWithNotice($: EngineInterface, slug: string, from: string): Promise<boolean> {
  const err = await withBusy($, `Starting ${slug}${from ? ` at ${from}` : ''}`, () => launch($, slug, from))
  if (err) await notify($, err)
  await refresh($)

  return !err
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
  await launchWithNotice($, slug, '')
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
  let refused = false
  for (const slug of slugs.slice(0, free)) if (!(await launchWithNotice($, slug, ''))) refused = true
  await update($, queue, q => [...q, ...slugs.slice(free).filter(x => !q.includes(x))])
  await update($, selected, () => ({}))
  if (!refused) await notify($, `Started ${Math.min(free, slugs.length)}, queued ${Math.max(0, slugs.length - free)} (at most ${CAP} run at once).`)
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
  await launchWithNotice($, next, '')
}

// Saves the developer's text for one stage; the pipeline hands it to that stage's agent.
async function saveManualInput($: EngineInterface, run: Run, key: string, value: string) {
  const path = `${run.worktree}/Docs/backlog/${run.slug}/manual-inputs.md`
  await $.fs.write(path, setManualInput((await readText($, path)) ?? '', key, value))
  await notify($, `Input saved for ${key} of ${run.slug}.`)
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
  await launchWithNotice($, run.slug, '')
  await notify($, `Answers saved, ${run.slug} resumed.`)
  await refresh($)
}

// ---- CONFIG pane: providers and models of the model registry, through `sdlc-mod.sh model ...` ----

const firstLine = (text: string): string => (text.split('\n').map(l => l.trim()).find(Boolean) ?? '')

// Runs `sdlc-mod.sh model <args>`; `line` is the message line to show: stdout on success, else stderr, else stdout.
async function runModel($: EngineInterface, args: string[]): Promise<{ ok: boolean; stdout: string; line: string }> {
  try {
    const r = await $.process.run(['bash', WRAPPER, 'model', ...args])
    const ok = r.exitCode === 0

    return { ok, stdout: r.stdout, line: ok ? firstLine(r.stdout) : firstLine(r.stderr) || firstLine(r.stdout) || `failed (exit ${r.exitCode})` }
  } catch (e) {
    return { ok: false, stdout: '', line: firstLine(String((e as { message?: string })?.message ?? e)) || 'failed' }
  }
}

async function loadConfig($: EngineInterface) {
  const r = await runModel($, ['list', '--json'])
  const providers = r.ok ? parse(r.stdout)?.providers : null

  if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
    const list: Record<string, ConfigProvider> = {}
    for (const [name, v] of Object.entries(providers as Record<string, Record<string, unknown>>)) {
      const models = Array.isArray(v?.models) && v.models.every(m => typeof m === 'string') ? (v.models as string[]) : []
      list[name] = { endpoint: String(v?.endpoint ?? ''), api_key_env: String(v?.api_key_env ?? ''), models, effort: v?.effort === true, key_set: v?.key_set === true }
    }
    await update($, configList, () => list)
    await update($, configError, () => '')
  } else {
    await update($, configList, () => null)
    await update($, configError, () => r.line || 'model list --json: unexpected output')
  }
}

async function openConfig($: EngineInterface) {
  await update($, configView, () => 'list')
  await update($, configEditing, () => '')
  await update($, configConfirmProvider, () => '')
  await update($, configConfirmModel, () => null)
  await loadConfig($)
  await $.ui.open({ id: CONFIG_PANE, title: 'CONFIG' })
}

// Arguments of `model add` for the form. `add` replaces the provider's stored endpoint, key variable, models and effort flag with these.
const addArgs = (form: ConfigForm): string[] => [
  'add', form.provider, '--endpoint', form.endpoint, '--key-env', form.keyEnv, '--models', form.models,
  ...(form.effort ? ['--effort'] : []),
]

async function showForm($: EngineInterface, provider: string) {
  const list = await read($, configList)
  const p = provider && list && Object.prototype.hasOwnProperty.call(list, provider) ? list[provider] : null
  await update($, configForm, () => (p ? { provider, endpoint: p.endpoint, keyEnv: p.api_key_env, models: p.models.join(','), effort: p.effort } : EMPTY_FORM))
  await update($, configEditing, () => (p ? provider : ''))
  await update($, configView, () => 'form')
}

async function showList($: EngineInterface) {
  await update($, configView, () => 'list')
  await update($, configEditing, () => '')
  await update($, configForm, () => EMPTY_FORM)
  await loadConfig($)
}

// Saves the form. A new provider whose name is taken is refused (it would overwrite the stored one: use Edit).
// `another` stays on an empty form for the next provider; otherwise the pane goes back to the list. A rejected save stays on the form.
async function saveForm($: EngineInterface, another: boolean) {
  const typed = await read($, configForm)
  // The registry only takes lowercase names: OpenRouter is stored as openrouter.
  const form = { ...typed, provider: typed.provider.trim().toLowerCase() }
  const editing = await read($, configEditing)
  const list = await read($, configList)
  if (!editing && list && Object.prototype.hasOwnProperty.call(list, form.provider)) {
    await notify($, `${form.provider} already exists: press Edit on it`)

    return
  }
  const r = await withBusy($, `Saving ${editing || form.provider}`, () => runModel($, addArgs({ ...form, provider: editing || form.provider })))
  await notify($, r.line)
  if (!r.ok) return
  await loadConfig($)
  if (another) {
    await update($, configForm, () => EMPTY_FORM)
    await update($, configEditing, () => '')
  } else {
    await showList($)
  }
}

async function testModel($: EngineInterface, provider: string, model: string) {
  const r = await withBusy($, `Testing ${provider}/${model}: waiting for the provider to answer (up to 10 s)`, () => runModel($, ['test', `${provider}/${model}`]))
  await notify($, `${provider}/${model}: ${r.ok ? 'ok' : r.line}`)
  await loadConfig($)
}

async function removeModel($: EngineInterface, provider: string, model: string) {
  const r = await runModel($, ['remove-model', provider, model])
  await notify($, r.line)
  await update($, configConfirmModel, () => null)
  await loadConfig($)
}

async function removeProvider($: EngineInterface, provider: string) {
  const r = await runModel($, ['remove', provider])
  await notify($, r.line)
  await update($, configConfirmProvider, () => '')
  await loadConfig($)
}

// Pipeline stage (as the monitor names it) -> the sdlc.sh stages whose agents run in it.
const STAGE_AGENTS: Record<string, string[]> = {
  Spec: ['spec'], Plan: ['plan'], 'Red tests': ['red-tests'], Implement: ['implement'], 'Test repair': ['test-repair', 'test-audit'], Review: ['review'],
}
const modelOf = (m?: { model: string; effort: string }) => (m ? `${m.model} · ${m.effort}` : '')
// "opus · medium" for a stage; the Test repair stage lists its repair and audit agents. '' when status.json has no model data.
const stageModel = (run: Run, name: string) => {
  const keys = STAGE_AGENTS[name] ?? []
  if (keys.length === 1) return modelOf(run.models[keys[0]])
  return keys.map(k => (run.models[k] ? `${k.replace('test-', '')} ${modelOf(run.models[k])}` : '')).filter(Boolean).join(' / ')
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

const stateLine = (run: Run, now: number) => {
  if (run.state === 'running') return `${run.stage || 'Starting'} · ${run.agent || '…'}${run.model ? ` (${run.model} · ${run.effort})` : ''} · ${clock(now - Date.parse(run.agentStarted))}${run.attempt ? ` · attempt ${run.attempt}` : ''}`
  if (run.state === 'paused') return `needs answers: ${run.questions.length} question${run.questions.length === 1 ? '' : 's'}`
  if (run.state === 'done') return 'done'
  if (run.state === 'interrupted') return `interrupted at ${run.stage || 'start'}`
  if (run.state === 'stopped') return `stopped (process gone) at ${run.stage || 'start'}`
  if (run.state === 'failed') return run.message ? `failed: ${run.message}` : `failed at ${run.stage || 'start'}`

  return 'starting'
}

// The overview row: the state line, then the file counts when there is something to say.
function oneLine(run: Run, now: number): string {
  const line = stateLine(run, now)
  const c = run.changes
  if (!c) return line
  if (c.changed === 0 && c.uncommitted === 0) return run.state === 'running' ? `${line} · no changes yet` : line

  return `${line} · ${c.changed} file${c.changed === 1 ? '' : 's'} changed (${c.uncommitted} uncommitted)`
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

// Copies `text` to the clipboard of the surface that was pressed, and says whether it worked.
async function copyText($: EngineInterface, text: string, surface: unknown) {
  const r = await $.ui.copy({ text, surface } as never)
  $.ui.toast(r.isCopied ? 'Copied' : `Could not copy (${r.reason})`)
}

// The loader line (while a button press is working) and the last notice with Copy and Dismiss; both stay until they are gone.
async function feedback($: EngineInterface, els: { Box: any; Text: any; Button: any }) {
  const { Box, Text, Button } = els
  const label = await read($, busy)
  const spin = SPIN[(await read($, frame)) % SPIN.length]
  const message = await read($, notice)
  if (!label && !message) return null

  return (
    <Box flexDirection="column">
      {label && <Text color="yellow">{spin} {label}...</Text>}
      {message && (
        <Box gap={1} flexWrap="wrap">
          <Text color="cyan">{message}</Text>
          <Button key="notice-copy" label="Copy" onPress={(press: { surface?: unknown }) => copyText($, message, press?.surface)} />
          <Button key="notice-dismiss" label="Dismiss" onPress={() => update($, notice, () => '')} />
        </Box>
      )}
    </Box>
  )
}

// Why a failed run failed, with a Copy button.
function reasonBox($: EngineInterface, els: { Box: any; Text: any; Button: any }, run: Run) {
  const { Box, Text, Button } = els
  if (!run.reason.length) return null
  const text = run.reason.join('\n')

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color="red">Why it failed{run.stage ? ` (${run.stage})` : ''}</Text>
        <Button key="reason-copy" label="Copy" onPress={(press: { surface?: unknown }) => copyText($, text, press?.surface)} />
      </Box>
      {run.reason.map((line, i) => (
        <Text key={`reason-${i}`} dimColor>{line}</Text>
      ))}
    </Box>
  )
}

let previous: Record<string, RunState> = {}
let isFirst = true

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sdlc-monitor', description: 'Open the SDLC control pane: start, watch, answer and stop pipelines' })
    await $.command.register({ name: 'sdlc-config', description: 'Open the CONFIG pane: providers and models of the model registry' })
    $.clock.every(SPIN_MS, async () => {
      if (await read($, busy)) await update($, frame, n => n + 1)
    })
    $.clock.every(EVERY_MS, async () => {
      const s = await refresh($)
      await drainQueue($, s)
      await sweepAgents($)
      const now: Record<string, RunState> = {}
      for (const r of s.runs) {
        now[r.slug] = r.state
        if (!isFirst && previous[r.slug] && previous[r.slug] !== r.state) {
          if (r.state === 'paused') await notify($, `${r.slug} is paused: ${r.questions.length} question(s) need answers`)
          else if (r.state === 'failed' || r.state === 'stopped') await notify($, `${r.slug} failed at ${r.stage || 'start'}`)
          else if (r.state === 'done') await notify($, `${r.slug} is done`)
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

  on('command.run', { command: 'sdlc-config' }, async $ => {
    await openConfig($)

    return { text: 'CONFIG opened: providers and models.' }
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

  // The always-visible entry points: the SDLC and CONFIG buttons above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const q = await read($, queue)
    const live = s.runs.filter(r => r.state === 'running' || r.state === 'starting' || r.state === 'paused')

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Button key="sdlc-open" label="SDLC" variant="primary" onPress={() => $.ui.open({ id: PANE, title: 'SDLC control' })} />
          <Button key="config-open" label="CONFIG" onPress={() => openConfig($)} />
          <Text dimColor>{live.length || q.length ? summary(s.runs, q.length) : `${s.pending.length} pending`}</Text>
        </Box>
        {await feedback($, { Box, Text, Button })}
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
      const rows = Object.values(await read($, agents))
      const chosen = Object.keys(pick).filter(k => pick[k]).length
      const running = s.runs.filter(r => r.state === 'running' || r.state === 'starting').length

      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Text bold>
            SDLC control <Text dimColor> {summary(s.runs, waiting.length)} · up to {CAP} at once</Text>
          </Text>
          {await feedback($, { Box, Text, Button })}

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
                await launchWithNotice($, run.slug, resumeFrom(run))
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
                  await notify($, `Discarded ${run.slug}.`)
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
        {await feedback($, { Box, Text, Button })}
        {reasonBox($, { Box, Text, Button }, run)}

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
            <Box key={`stage-${st.name}`} flexDirection="column" borderStyle="round" borderColor={STAGE_COLOR[st.state]} paddingX={1}>
              <Text color={STAGE_COLOR[st.state]} bold={st.state === 'active'} dimColor={st.state === 'pending'}>
                {STAGE_GLYPH[st.state]} {st.name}
              </Text>
              {stageModel(run, st.name) && <Text dimColor>{stageModel(run, st.name)}</Text>}
            </Box>
          ))}
        </Box>

        {run.state === 'running' && run.agent && (
          <Box flexDirection="column">
            <Text bold>Agent</Text>
            <Text>
              <Text color="cyan">{run.agent}</Text>
              {run.model && <Text>  {run.model} · {run.effort}</Text>}
              <Text dimColor>  running {clock(since)}</Text>
            </Text>
            {tryMax > 0 && (
              <Text>
                attempt {bar(tryNo, tryMax, tryMax * 3)} {tryNo}/{tryMax}
              </Text>
            )}
          </Box>
        )}

        {run.changes && <Text>{`Files  ${run.changes.changed} changed since ${run.base || 'base'} · ${run.changes.uncommitted} uncommitted`}</Text>}

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

        {canResume && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Manual input per stage (type, press Enter to save; saving an empty line clears it)</Text>
            {INPUT_STAGES.map(st => (
              <Box key={`input-${st.key}`} gap={1} flexWrap="wrap">
                <Text>{st.label}</Text>
                <Input key={`in-${st.key}`} placeholder={`instructions for the ${st.label} agent`} onSubmit={value => saveManualInput($, run, st.key, value)} />
                <Button
                  key={`resume-at-${st.key}`}
                  label={`Resume at ${st.label}`}
                  onPress={async () => {
                    await launchWithNotice($, run.slug, st.key === 'spec' ? '' : st.key)
                  }}
                />
              </Box>
            ))}
          </Box>
        )}

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

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const view = await read($, configView)
    const editing = await read($, configEditing)
    const form = await read($, configForm)

    if (view === 'form') {
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Text bold>{editing ? `Edit ${editing}` : 'Add a provider'}</Text>
          {await feedback($, { Box, Text, Button })}
          {CONFIG_FIELDS.filter(f => !(editing && f.key === 'provider')).map(f => (
            <Input
              key={`config-in-${f.key}`}
              label={`${f.label}: `}
              placeholder={f.label}
              value={form[f.key]}
              onInput={value => update($, configForm, d => ({ ...d, [f.key]: value.trim() }))}
              onSubmit={value => update($, configForm, d => ({ ...d, [f.key]: value.trim() }))}
            />
          ))}
          <Box gap={1} flexWrap="wrap">
            <Button
              key="config-effort"
              label={form.effort ? 'Effort flag: on' : 'Effort flag: off'}
              onPress={() => update($, configForm, d => ({ ...d, effort: !d.effort }))}
            />
            <Text dimColor>models: comma list; the effort flag passes --effort, which many models reject</Text>
          </Box>
          <Box gap={1} flexWrap="wrap">
            <Button key="config-save" label="Save" variant="primary" onPress={() => saveForm($, false)} />
            {!editing && <Button key="config-save-another" label="Save and add another" onPress={() => saveForm($, true)} />}
            <Button key="config-cancel" label="Cancel" onPress={() => showList($)} />
          </Box>
        </Box>
      )
    }

    const list = await read($, configList)
    const error = await read($, configError)
    const pendingProvider = await read($, configConfirmProvider)
    const pendingModel = await read($, configConfirmModel)
    const names = list ? Object.keys(list) : []

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box gap={1} flexWrap="wrap">
          <Text bold>CONFIG</Text>
          <Button key="config-add-new" label="Add provider" variant="primary" onPress={() => showForm($, '')} />
        </Box>
        {await feedback($, { Box, Text, Button })}
        {error ? <Text color="red">{error}</Text> : null}
        {!error && list && names.length === 0 && <Text dimColor>No custom providers</Text>}
        {!error &&
          list &&
          names.map(name => {
            const p = list[name]
            const removing = pendingProvider === name

            return (
              <Box key={`config-provider:${name}`} flexDirection="column">
                <Box gap={1} flexWrap="wrap">
                  <Text bold>{name}</Text>
                  <Text dimColor>{p.endpoint}</Text>
                  <Text dimColor>{p.api_key_env}</Text>
                  <Text color={p.key_set ? 'green' : 'yellow'}>{p.key_set ? 'key set' : 'key NOT set'}</Text>
                  <Button key={`config-edit:${name}`} label="Edit" onPress={() => showForm($, name)} />
                  <Button
                    key={`config-remove-provider:${name}`}
                    label={removing ? 'Confirm remove' : 'Remove'}
                    variant={removing ? 'primary' : undefined}
                    onPress={async () => {
                      if (removing) await removeProvider($, name)
                      else await update($, configConfirmProvider, () => name)
                    }}
                  />
                  {removing && <Button key="config-keep-provider" label="Keep it" onPress={() => update($, configConfirmProvider, () => '')} />}
                </Box>
                {p.models.map(model => {
                  const removingModel = pendingModel?.provider === name && pendingModel.model === model

                  return (
                    <Box key={`config-model:${name}/${model}`} gap={1} flexWrap="wrap" paddingLeft={2}>
                      <Text>{model}</Text>
                      <Button key={`config-test:${name}/${model}`} label="Test" onPress={() => testModel($, name, model)} />
                      <Button
                        key={`config-remove-model:${name}/${model}`}
                        label={removingModel ? 'Confirm remove' : 'Remove'}
                        variant={removingModel ? 'primary' : undefined}
                        onPress={async () => {
                          if (removingModel) await removeModel($, name, model)
                          else await update($, configConfirmModel, () => ({ provider: name, model }))
                        }}
                      />
                      {removingModel && <Button key="config-keep-model" label="Keep it" onPress={() => update($, configConfirmModel, () => null)} />}
                    </Box>
                  )
                })}
                {p.effort && <Text dimColor>effort</Text>}
              </Box>
            )
          })}
      </Box>
    )
  })
}

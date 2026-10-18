import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Claim, ConfigForm, ConfigProvider, PendingItem, PermissionAsk, Question, Run, RunState, Snapshot } from '../types'

const PANE = 'sdlc'
const CONFIG_PANE = 'config'
// How often the background loop refreshes; the Refresh button reloads at once when needed.
const EVERY_MS = 20000
const PENDING_EVERY_MS = 10000
const CAP = 2
const WRAPPER = 'scripts/sdlc-mod.sh'
// How often the file counts of a running pipeline are recomputed when nothing else about it changed (see loadChanges).
const CHANGES_EVERY_MS = 15000
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
// Files listed per stage in the run view before "+N more".
const FILES_SHOWN = 8
const RESUME_AT_IMPLEMENT = ['Implement', 'Test repair', 'Review', 'Commit']
// Stages before Implement that a failed run resumes at, so a Plan failure does not run Spec (and its questions) again.
const RESUME_AT_STAGE: Record<string, string> = { Plan: 'plan', 'Red tests': 'red-tests' }

const EMPTY: Snapshot = { now: 0, runs: [], pending: [], discarded: {} }
const snapshot = atom({ plugin: 'sdlc-monitor', key: 'snapshot' } as const, EMPTY)
const agents = atom({ plugin: 'sdlc-monitor', key: 'agents' } as const, {} as Record<string, AgentRow>)
const view = atom({ plugin: 'sdlc-monitor', key: 'view' } as const, '')
const selected = atom({ plugin: 'sdlc-monitor', key: 'selected' } as const, {} as Record<string, boolean>)
const queue = atom({ plugin: 'sdlc-monitor', key: 'queue' } as const, [] as string[])
const confirmStop = atom({ plugin: 'sdlc-monitor', key: 'confirmStop' } as const, '')
const confirmDiscard = atom({ plugin: 'sdlc-monitor', key: 'confirmDiscard' } as const, '')
// Pipelines whose Test repair claim is shown (the Show claim button in the Test repair box).
const showClaim = atom({ plugin: 'sdlc-monitor', key: 'showClaim' } as const, {} as Record<string, boolean>)
const launching = atom({ plugin: 'sdlc-monitor', key: 'launching' } as const, {} as Record<string, number>)
const draft = atom({ plugin: 'sdlc-monitor', key: 'draft' } as const, {} as Record<string, string>)
const boardOffset = atom({ plugin: 'sdlc-monitor', key: 'boardOffset' } as const, 0)
const notice = atom({ plugin: 'sdlc-monitor', key: 'notice' } as const, '')
// What a button press is working on ('' when idle), and the spinner frame drawn beside it.
const busy = atom({ plugin: 'sdlc-monitor', key: 'busy' } as const, '')
// The key of the button whose action is running ('' when none): it shows the spinner, and no other action starts until it ends.
const working = atom({ plugin: 'sdlc-monitor', key: 'working' } as const, '')
const frame = atom({ plugin: 'sdlc-monitor', key: 'frame' } as const, 0)
// True while any refresh runs (the background loop, a button, a command): the Refresh button spins and takes no press until it ends.
const refreshing = atom({ plugin: 'sdlc-monitor', key: 'refreshing' } as const, false)
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN_MS = 250
const spinGlyph = (n: number) => SPIN[n % SPIN.length]
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

// the palette of the board design: a dark ground, one hue per state, grey for what is secondary
const P = {
  ground: '#14181f',
  column: '#10141a',
  card: '#181d25',
  cardSelected: '#12303a',
  line: '#2d333b',
  edge: '#3d444d',
  text: '#d0d7de',
  strong: '#e6edf3',
  muted: '#8b949e',
  run: '#56d4dd',
  wait: '#e3b341',
  fail: '#ff7b72',
  done: '#7ee787',
}

const GLYPH: Record<RunState, string> = { starting: '◌', running: '●', paused: '⏸', done: '✔', failed: '✘', interrupted: '■', stopped: '✘' }
const COLOR: Record<RunState, string> = { starting: P.run, running: P.run, paused: P.wait, done: P.done, failed: P.fail, interrupted: P.wait, stopped: P.fail }
const ORDER: Record<RunState, number> = { running: 0, paused: 1, starting: 2, failed: 3, stopped: 3, interrupted: 3, done: 4 }

type StageState = 'done' | 'active' | 'failed' | 'paused' | 'pending'
const STAGE_GLYPH: Record<StageState, string> = { done: '✔', active: '●', failed: '✘', paused: '⏸', pending: '○' }
const STAGE_COLOR: Record<StageState, string> = { done: P.done, active: P.run, failed: P.fail, paused: P.wait, pending: P.muted }

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

// The main working tree and the git common dir, as absolute paths. Every repo-relative path below hangs on them, so the pane
// behaves the same whatever directory the session is in, including a pipeline's own worktree (whose copy of the wrapper would
// read another root, another worktree folder and no run records). '' for both when git does not say: relative paths then.
let repoCache: { root: string; common: string } | null = null
async function repoInfo($: EngineInterface): Promise<{ root: string; common: string }> {
  if (!repoCache) {
    let common = ''
    let root = ''
    try {
      common = (await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim()
    } catch {
      // not in a git checkout
    }
    if (common.startsWith('/') && common.endsWith('/.git')) root = common.slice(0, -'/.git'.length)
    if (!common.startsWith('/')) common = ''
    // no usable answer: do not cache it, so a later call (git came up, the directory changed) asks again
    if (!root) return { root: '', common }
    repoCache = { root, common }
  }

  return repoCache
}

// A path inside the main working tree.
async function repoPath($: EngineInterface, rel: string): Promise<string> {
  const { root } = await repoInfo($)

  return root ? `${root}/${rel}` : rel
}

const wrapperPath = ($: EngineInterface) => repoPath($, WRAPPER)

let pendingAt = 0
let pendingCache: PendingItem[] = []

// Where sdlc-mod.sh keeps its run records: one folder shared by every worktree.
async function registryDir($: EngineInterface): Promise<string> {
  const { common } = await repoInfo($)

  return `${common || '.git'}/sdlc-runs`
}

async function loadPending($: EngineInterface, now: number): Promise<PendingItem[]> {
  if (now - pendingAt < PENDING_EVERY_MS && pendingAt) return pendingCache
  try {
    const r = await $.process.run(['node', await repoPath($, 'scripts/backlog-list.cjs'), 'pending', '--json'])
    const rows = JSON.parse(r.stdout) as { slug: string; type: string | null; priority: string | null; title: string }[]
    pendingCache = rows.map(x => ({ slug: x.slug, type: x.type ?? '-', priority: x.priority ?? '-', title: x.title }))
  } catch {
    pendingCache = []
  }
  pendingAt = now

  return pendingCache
}

// Files a pipeline has changed, counted by the wrapper inside the pipeline's own worktree. A pipeline started by hand has
// no record, so its changes cannot be told apart from the developer's own work: no counts. A pipeline is recounted only when
// something about it changed (its state, stage or status.json time), a running one also every CHANGES_EVERY_MS, and every
// one on Refresh. All the pipelines due are counted in one wrapper call (`changes --all <slug>...`); the rest reuse the last
// result, null included.
const changesCache = new Map<string, { at: number; sig: string; value: Run['changes'] }>()
const changeSig = (run: Run) => `${run.state}|${run.stage}|${run.updated}`

function countDue(run: Run, now: number, force: boolean): boolean {
  if (!run.managed) return false
  const hit = changesCache.get(run.slug)
  if (force || !hit || hit.sig !== changeSig(run)) return true

  return run.state === 'running' && now - hit.at >= CHANGES_EVERY_MS
}

async function loadChanges($: EngineInterface, runs: Run[], now: number, force: boolean) {
  const due = runs.filter(r => countDue(r, now, force))
  if (due.length) {
    let counted: Record<string, { changed?: unknown; uncommitted?: unknown }> = {}
    try {
      const r = await $.process.run(['bash', await wrapperPath($), 'changes', '--all', ...due.map(x => x.slug)])
      if (r.exitCode === 0) counted = (JSON.parse(r.stdout) as { runs?: typeof counted }).runs ?? {}
    } catch {
      counted = {}
    }
    for (const run of due) {
      const j = counted[run.slug]
      const value = j && typeof j.changed === 'number' && typeof j.uncommitted === 'number' ? { changed: j.changed, uncommitted: j.uncommitted } : null
      changesCache.set(run.slug, { at: now, sig: changeSig(run), value })
    }
  }
  for (const run of runs) run.changes = run.managed ? (changesCache.get(run.slug)?.value ?? null) : null
}

// The files each stage changed, from logs/stage-files.json (written by scripts/sdlc.sh; an unreadable file reads as none).
function parseStageFiles(text: string | null): Record<string, string[]> {
  const stages = parse(text)?.stages
  if (!stages || typeof stages !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [name, list] of Object.entries(stages as Record<string, unknown>)) {
    if (Array.isArray(list)) out[name] = list.filter((f): f is string => typeof f === 'string')
  }

  return out
}

// The undecided asks in logs/permissions.json (an unreadable or malformed file reads as none).
// test-issues.md: what the Implement agent claimed is wrong with a test, one "<file> :: <test name> :: <why>" line each.
function parseClaims(text: string | null): Claim[] {
  return (text ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [file = '', test = '', ...why] = line.split(' :: ')

    return why.length ? { file, test, why: why.join(' :: ') } : { file: '', test: '', why: line }
  })
}

// Why the pipeline refused the claim: the REJECT lines of the latest Test repair section of run.out.
function claimRejects(runOut: string): string[] {
  const at = runOut.lastIndexOf('== 4b Test repair')
  if (at < 0) return []

  return runOut.slice(at).split('\n').filter(l => /^(REJECT|TEST REPAIR REJECTED)/.test(l)).map(l => l.trim())
}

function parsePermissions(text: string | null): PermissionAsk[] {
  const j = parse(text)
  const list = j && Array.isArray(j.pending) ? j.pending : []

  return list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).tool === 'string')
    .map(a => ({ stage: String(a.stage ?? ''), tool: String(a.tool), detail: String(a.detail ?? ''), rule: String(a.rule ?? ''), protected: a.protected === true }))
}

// The stage to resume at once every ask of a stage is decided; spec starts from the beginning, and the audit step resumes at implement.
const resumeKey = (stage: string) => (stage === 'spec' ? '' : stage === 'test-audit' ? 'implement' : stage)

// Decides one ask (or all) through the wrapper; when none is left, the run resumes at the stage that was refused.
async function decidePermission($: EngineInterface, run: Run, which: string, choice: 'allow' | 'always' | 'deny') {
  await act($, `perm-${choice}:${which}`, `Saving your answer for ${run.slug}`, () => decideNow($, run, which, choice))
}

async function decideNow($: EngineInterface, run: Run, which: string, choice: 'allow' | 'always' | 'deny') {
  const r = await $.process.run(['bash', await wrapperPath($), 'permit', run.slug, choice, which])
  if (r.exitCode !== 0) {
    await notify($, firstLine(r.stderr) || `permit failed (exit ${r.exitCode})`)

    return
  }
  const left = Number(firstLine(r.stdout))
  const stage = run.permissions[which === 'all' ? 0 : Number(which)]?.stage ?? ''
  await notify($, `${choice === 'deny' ? 'Denied' : 'Allowed'}${left > 0 ? `: ${left} more to decide` : ''}`)
  await refresh($)
  if (left === 0) await launchWithNotice($, run.slug, resumeKey(stage))
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
async function loadRun($: EngineInterface, slug: string, worktree: string, reg: Record<string, unknown> | null): Promise<Run> {
  const root = worktree || (await repoInfo($)).root || '.'
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
    note: String(status?.note ?? ''),
    pid,
    files,
    tests: testCounts(await readText($, `${docs}/logs/tests.log`)),
    tail: runOut.split('\n').filter(l => l.trim()).slice(-8),
    stageFiles: parseStageFiles(await readText($, `${docs}/logs/stage-files.json`)),
    permissions: parsePermissions(await readText($, `${docs}/logs/permissions.json`)),
    claims: parseClaims(await readText($, `${docs}/test-issues.md`)),
    claimRejects: claimRejects(runOut),
    reason: state === 'failed' || state === 'stopped' ? await failureReason($, docs, stageName, runOut) : [],
    questions: questionsText ? parseQuestions(questionsText) : [],
    managed: reg !== null,
    message: String(reg?.message ?? ''),
    // filled in by loadChanges once every run is loaded
    changes: null,
    base: String(reg?.base ?? ''),
  }
}

async function collect($: EngineInterface, force = false): Promise<Snapshot> {
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
  for (const d of await names($, await repoPath($, 'Docs/backlog'))) {
    if (d.kind === 'dir' && !seen.has(d.name) && (await readText($, await repoPath($, `Docs/backlog/${d.name}/logs/status.json`)))) {
      runs.push(await loadRun($, d.name, '', null))
    }
  }
  runs.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updated.localeCompare(a.updated))
  await loadChanges($, runs, now, force)

  return { now, runs, pending: await loadPending($, now), discarded }
}

// Starts (or resumes) a pipeline in the background: it outlives this pane and this session.
// Waits 3 seconds: a wrapper that refuses or crashes by then is reported, with the last lines of its output. Returns '' or that error.
const LAUNCH_SCRIPT =
  `out="\${TMPDIR:-/tmp}/sdlc-launch-$0.out"; nohup bash "\${SDLC_WRAPPER:-${WRAPPER}}" run "$0" </dev/null >"$out" 2>&1 & pid=$!; sleep 3; ` +
  'if ! kill -0 $pid 2>/dev/null; then wait $pid; rc=$?; if [ $rc -ne 0 ] && [ $rc -ne 2 ]; then tail -5 "$out" >&2; echo "exit $rc" >&2; exit $rc; fi; fi'

async function launch($: EngineInterface, slug: string, from: string): Promise<string> {
  const env: Record<string, string> = { SDLC_MAX_PARALLEL: String(CAP), SDLC_WRAPPER: await wrapperPath($) }
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

// Runs one button's action: its label turns into a spinner until `work` has completely finished, and a second press is ignored meanwhile.
// The caller changes what the button shows next (confirm flags, notices) inside `work`, after the action is done.
async function act<T>($: EngineInterface, key: string, label: string, work: () => Promise<T>): Promise<T | undefined> {
  if (await read($, working)) return undefined
  await update($, working, () => key)
  try {
    return await withBusy($, label, work)
  } finally {
    await update($, working, () => '')
  }
}

// A button's label while its own action runs: the spinner and `doing`, else its normal text.
const labelOf = (now: string, spin: string, key: string, text: string, doing: string) => (now === key ? `${spin} ${doing}` : text)

// Reloads until the run has left running/starting (a stop takes a moment to show in the registry), at most `tries` times 300 ms.
async function settled($: EngineInterface, slug: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const s = await refresh($)
    const r = s.runs.find(x => x.slug === slug)
    if (!r || (r.state !== 'running' && r.state !== 'starting')) return
    await $.clock.sleep(300)
  }
}

// Starts or resumes one run and reports a refusal; used by every Start / Resume button.
async function launchWithNotice($: EngineInterface, slug: string, from: string): Promise<boolean> {
  const err = await withBusy($, `Starting ${slug}${from ? ` at ${from}` : ''}`, () => launch($, slug, from))
  if (err) await notify($, err)
  await refresh($)

  return !err
}

// Runs a wrapper command that changes a run; returns '' on success, else the line to show (its error, or the exit code).
async function wrapperChange($: EngineInterface, args: string[]): Promise<string> {
  try {
    const r = await $.process.run(['bash', await wrapperPath($), ...args])

    return r.exitCode === 0 ? '' : firstLine(r.stderr) || firstLine(r.stdout) || `failed (exit ${r.exitCode})`
  } catch (e) {
    return firstLine(String((e as { message?: string })?.message ?? e)) || 'failed'
  }
}

async function stopRun($: EngineInterface, slug: string) {
  return wrapperChange($, ['stop', slug])
}

// Stops the pipeline if it runs, then deletes its worktree, branch and run record (the branch tip is saved).
async function discardRun($: EngineInterface, slug: string) {
  return wrapperChange($, ['discard', slug, '--yes', '--stop'])
}

async function startRun($: EngineInterface, slug: string) {
  await act($, 'start', `Starting ${slug}`, () => startNow($, slug))
}

async function startNow($: EngineInterface, slug: string) {
  const now = await $.clock.now()
  await update($, launching, l => ({ ...l, [slug]: now }))
  await launchWithNotice($, slug, '')
}

const resumeFrom = (run: Run) => (RESUME_AT_IMPLEMENT.includes(run.stage) ? 'implement' : RESUME_AT_STAGE[run.stage] ?? '')

// The refresh in progress, if any. A second caller does not start another one: it gets the running one's result, and a forced
// refresh (the Refresh button) waits for it to end and then runs its own, so two refreshes never overlap.
let inFlight: Promise<Snapshot> | null = null

async function refresh($: EngineInterface, force = false): Promise<Snapshot> {
  while (inFlight) {
    if (!force) return inFlight
    await inFlight.catch(() => undefined)
  }
  await update($, refreshing, () => true)
  inFlight = refreshNow($, force)
  try {
    return await inFlight
  } finally {
    inFlight = null
    await update($, refreshing, () => false)
  }
}

async function refreshNow($: EngineInterface, force: boolean): Promise<Snapshot> {
  const s = await collect($, force)
  await update($, snapshot, () => s)
  const pressed = await read($, launching)
  const left = Object.fromEntries(Object.entries(pressed).filter(([k]) => !s.runs.some(r => r.slug === k)))
  if (Object.keys(left).length !== Object.keys(pressed).length) await update($, launching, () => left)

  return s
}

// Starts as many of the selected items as the cap allows; the rest wait in the queue.
async function runSelected($: EngineInterface) {
  await act($, 'run-selected', 'Starting the selected items', () => runSelectedNow($))
}

async function runSelectedNow($: EngineInterface) {
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
  await act($, 'submit-answers', `Saving the answers of ${run.slug}`, () => submitNow($, run))
}

async function submitNow($: EngineInterface, run: Run) {
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
    const r = await $.process.run(['bash', await wrapperPath($), 'model', ...args])
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
  await act($, 'config-open', 'Opening CONFIG', () => openConfigNow($))
}

async function openConfigNow($: EngineInterface) {
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

async function showListNow($: EngineInterface) {
  await loadConfig($)
  await update($, configView, () => 'list')
  await update($, configEditing, () => '')
  await update($, configForm, () => EMPTY_FORM)
}

async function showList($: EngineInterface) {
  await act($, 'config-cancel', 'Loading the providers', () => showListNow($))
}

// Saves the form. A new provider whose name is taken is refused (it would overwrite the stored one: use Edit).
// `another` stays on an empty form for the next provider; otherwise the pane goes back to the list. A rejected save stays on the form.
async function saveForm($: EngineInterface, another: boolean) {
  await act($, another ? 'config-save-another' : 'config-save', 'Saving the provider', () => saveNow($, another))
}

async function saveNow($: EngineInterface, another: boolean) {
  const typed = await read($, configForm)
  // The registry only takes lowercase names: OpenRouter is stored as openrouter.
  const form = { ...typed, provider: typed.provider.trim().toLowerCase() }
  const editing = await read($, configEditing)
  const list = await read($, configList)
  if (!editing && list && Object.prototype.hasOwnProperty.call(list, form.provider)) {
    await notify($, `${form.provider} already exists: press Edit on it`)

    return
  }
  const r = await runModel($, addArgs({ ...form, provider: editing || form.provider }))
  await notify($, r.line)
  if (!r.ok) return
  await loadConfig($)
  if (another) {
    await update($, configForm, () => EMPTY_FORM)
    await update($, configEditing, () => '')
  } else {
    await showListNow($)
  }
}

async function testModel($: EngineInterface, provider: string, model: string) {
  await act($, `config-test:${provider}/${model}`, `Testing ${provider}/${model}: waiting for the provider to answer (up to 10 s)`, async () => {
    const r = await runModel($, ['test', `${provider}/${model}`])
    await notify($, `${provider}/${model}: ${r.ok ? 'ok' : r.line}`)
    await loadConfig($)
  })
}

async function removeModel($: EngineInterface, provider: string, model: string) {
  await act($, `config-remove-model:${provider}/${model}`, `Removing ${provider}/${model}`, async () => {
    const r = await runModel($, ['remove-model', provider, model])
    await notify($, r.line)
    await loadConfig($)
    await update($, configConfirmModel, () => null)
  })
}

async function removeProvider($: EngineInterface, provider: string) {
  await act($, `config-remove-provider:${provider}`, `Removing ${provider}`, async () => {
    const r = await runModel($, ['remove', provider])
    await notify($, r.line)
    await loadConfig($)
    await update($, configConfirmProvider, () => '')
  })
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
  }).filter(st => st.name !== 'Test repair' || st.state === 'active' || st.state === 'failed' || wasRepaired || run.claims.length > 0)
}

const summary = (runs: Run[], queued: number) => {
  const n = (state: RunState) => runs.filter(r => r.state === state).length
  const parts = [`${n('running') + n('starting')} running`, `${n('paused')} paused`]
  if (queued) parts.push(`${queued} queued`)

  return parts.join(' · ')
}

const stateLine = (run: Run, now: number) => {
  if (run.state === 'running' && run.note) return `${run.stage || 'Starting'} · waiting: ${run.note}`
  if (run.state === 'running') return `${run.stage || 'Starting'} · ${run.agent || '…'}${run.model ? ` (${run.model} · ${run.effort})` : ''} · ${clock(now - Date.parse(run.agentStarted))}${run.attempt ? ` · attempt ${run.attempt}` : ''}`
  if (run.state === 'paused' && run.permissions.length) return `needs a decision: ${run.permissions.length} refused action${run.permissions.length === 1 ? '' : 's'}`
  if (run.state === 'paused' && !run.questions.length) return `paused at ${run.stage || 'start'}`
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
    <Box flexDirection="column" backgroundColor={P.ground}>
      {label && <Text color={P.wait} backgroundColor={P.ground}>{spin} {label}...</Text>}
      {message && (
        <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
          <Text color={P.run} backgroundColor={P.ground}>{message}</Text>
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
    <Box flexDirection="column" backgroundColor={P.ground}>
      <Box gap={1} backgroundColor={P.ground}>
        <Text bold color={P.fail} backgroundColor={P.ground}>Why it failed{run.stage ? ` (${run.stage})` : ''}</Text>
        <Button key="reason-copy" label="Copy" onPress={(press: { surface?: unknown }) => copyText($, text, press?.surface)} />
      </Box>
      {run.reason.map((line, i) => (
        <Text key={`reason-${i}`} color={P.muted} backgroundColor={P.ground}>{line}</Text>
      ))}
    </Box>
  )
}

const BOARD_COLS = ['Backlog', 'Spec', 'Plan', 'Red tests', 'Implement', 'Review', 'Done']
// narrowest a board column is drawn; the pane shows as many whole columns as fit
const COL_MIN = 24
// the share of the pane the selected pipeline's details take
const DETAIL_SHARE = 0.75
// the board column of each stage in STAGES: Test repair belongs to Implement, Commit to Done
const STAGE_COLUMN = [1, 2, 3, 4, 4, 5, 6]

const stageColumn = (run: Run): number => {
  if (run.state === 'done') return 6
  const i = STAGES.indexOf(run.stage)

  return i < 0 ? 1 : STAGE_COLUMN[i]
}

// How many whole columns fit in `width`, and the first one drawn: the stored offset, moved so the selected column shows.
function boardWindow(width: number, first: number, selected: number): { visible: number; first: number } {
  const visible = Math.min(BOARD_COLS.length, Math.max(1, Math.floor(width / COL_MIN)))
  let at = first
  if (selected >= 0 && selected < at) at = selected
  if (selected > at + visible - 1) at = selected - visible + 1

  return { visible, first: Math.min(Math.max(0, at), BOARD_COLS.length - visible) }
}

// The kanban board: the backlog and the pipelines by stage, with the controls to start, queue and clear runs.
async function boardView($: EngineInterface, els: { Box: any; Text: any; Button: any }, s: Snapshot, o: { width: number; current: string; narrow: boolean }) {
  const { Box, Text, Button } = els
  const pick = await read($, selected)
  const waiting = await read($, queue)
  const rows = Object.values(await read($, agents))
  const spin = spinGlyph(await read($, frame))
  const now = await read($, working)
  const reloading = await read($, refreshing)
  const chosen = Object.keys(pick).filter(k => pick[k]).length
  const running = s.runs.filter(r => r.state === 'running' || r.state === 'starting').length
  const currentRun = s.runs.find(r => r.slug === o.current)
  const selCol = currentRun ? stageColumn(currentRun) : o.current ? 0 : -1
  const { visible, first } = boardWindow(o.width, await read($, boardOffset), selCol)
  const shown = BOARD_COLS.slice(first, first + visible)
  const colW = Math.max(COL_MIN, Math.floor(o.width / visible))
  const step = (by: number) => update($, boardOffset, () => Math.min(Math.max(0, first + by), BOARD_COLS.length - visible))
  const started = (slug: string) => s.runs.some(r => r.slug === slug)

  const backlog = s.pending.filter(p => !started(p.slug) && !waiting.includes(p.slug))
  const sorted = [...s.runs].sort((a, b) => ORDER[a.state] - ORDER[b.state])

  const card = (key: string, edge: string, fill: string, children: any) => (
    <Box key={`card-${key}`} flexDirection="column" borderStyle="single" borderColor={edge} backgroundColor={fill}>
      {children}
    </Box>
  )

  return (
    <Box flexDirection="column" width={o.width} backgroundColor={P.ground}>
      <Box gap={1} paddingX={1} flexWrap="wrap" backgroundColor={P.ground}>
        <Text bold color={P.strong} backgroundColor={P.ground}>
          SDLC control
        </Text>
        <Text color={P.muted} backgroundColor={P.ground}>
          {summary(s.runs, waiting.length)} · up to {CAP} at once
        </Text>
        {/* reloads now and recounts every pipeline's files. While any refresh runs, its own or the background one, it spins and a press is ignored. */}
        <Button
          key="refresh"
          label={reloading ? `${spin} Refreshing...` : labelOf(now, spin, 'refresh', 'Refresh', 'Refreshing...')}
          onPress={async () => {
            if (await read($, refreshing)) return
            await act($, 'refresh', 'Refreshing', () => refresh($, true))
          }}
        />
      </Box>
      {!o.narrow && (await feedback($, { Box, Text, Button }))}
      <Box gap={1} paddingX={1} flexWrap="wrap" backgroundColor={P.ground}>
        <Button key="board-left" label="◀" hotkey="h" onPress={() => step(-1)} />
        <Button key="board-right" label="▶" hotkey="l" onPress={() => step(1)} />
        <Text color={P.muted} backgroundColor={P.ground}>
          columns {first + 1}-{first + visible} of {BOARD_COLS.length}
        </Text>
        <Button key="run-selected" label={labelOf(now, spin, 'run-selected', `Run selected (${chosen})`, 'Starting...')} variant="primary" onPress={() => runSelected($)} />
        <Button key="clear-selected" label="Clear" onPress={() => update($, selected, () => ({}))} />
        <Text color={P.muted} backgroundColor={P.ground}>
          {running >= CAP ? 'both slots busy: extra items will queue' : `${CAP - running} slot(s) free`}
        </Text>
      </Box>
      <Box gap={1} backgroundColor={P.ground}>
        {shown.map((name, i) => {
          const col = first + i
          const runs = sorted.filter(r => stageColumn(r) === col)
          const count = col === 0 ? backlog.length + waiting.length : runs.length

          return (
            <Box key={`col-${col}`} flexDirection="column" width={colW - 1} borderStyle="single" borderColor={P.line} backgroundColor={P.column}>
              <Box justifyContent="space-between" paddingX={1} backgroundColor={P.column}>
                <Text bold color={P.strong} backgroundColor={P.column}>
                  {name}
                </Text>
                <Text color={P.muted} backgroundColor={P.column}>
                  {count}
                </Text>
              </Box>
              {col === 0 && s.pending.length === 0 && waiting.length === 0 && (
                <Text color={P.muted} backgroundColor={P.column}>
                  {' '}Nothing pending
                </Text>
              )}
              {col === 0 &&
                backlog.map(p => {
                  const isOn = pick[p.slug] === true
                  const isCur = p.slug === o.current
                  const fill = isOn || isCur ? P.cardSelected : P.card

                  return card(
                    p.slug,
                    isCur ? P.run : isOn ? P.run : P.edge,
                    fill,
                    <Box key={`pending-${p.slug}`} flexDirection="column" backgroundColor={fill}>
                      <Box gap={1} backgroundColor={fill}>
                        <Button key={`sel-${p.slug}`} label={cut(`${isOn ? '[x]' : '[ ]'} ${p.slug}`, colW - 19)} onPress={() => update($, selected, m => ({ ...m, [p.slug]: !m[p.slug] }))} />
                        <Button key={`more-${p.slug}`} label="Open" variant={isCur ? 'primary' : undefined} onPress={() => update($, view, () => p.slug)} />
                      </Box>
                      <Text color={P.muted} backgroundColor={fill}>
                        {cut(`${p.type} ${p.priority} · ${p.title}`, (colW - 7) * 2)}
                      </Text>
                    </Box>,
                  )
                })}
              {col === 0 &&
                waiting.map(slug =>
                  card(
                    `queued-${slug}`,
                    P.edge,
                    P.card,
                    <Box key={`queued-${slug}`} flexDirection="column" backgroundColor={P.card}>
                      <Text color={P.muted} backgroundColor={P.card}>
                        {cut(`◌ ${slug} queued`, (colW - 7) * 2)}
                      </Text>
                    </Box>,
                  ),
                )}
              {col !== 0 && runs.length === 0 && (
                <Text color={P.muted} backgroundColor={P.column}>
                  {' '}nothing here
                </Text>
              )}
              {col !== 0 &&
                runs.map(r => {
                  const isCur = r.slug === o.current
                  const fill = isCur ? P.cardSelected : P.card
                  const edge = isCur ? P.run : r.state === 'paused' ? P.wait : r.state === 'failed' || r.state === 'stopped' ? P.fail : P.edge

                  return card(
                    r.slug,
                    edge,
                    fill,
                    <Box key={`run-${r.slug}`} flexDirection="column" backgroundColor={fill}>
                      <Button key={`open-${r.slug}`} label={cut(`${r.state === 'running' || r.state === 'starting' ? spin : GLYPH[r.state]} ${r.slug}`, colW - 11)} variant={r.state === 'paused' || isCur ? 'primary' : undefined} onPress={() => update($, view, () => r.slug)} />
                      <Text color={COLOR[r.state]} backgroundColor={fill}>
                        {cut(oneLine(r, s.now), (colW - 7) * 2)}
                      </Text>
                    </Box>,
                  )
                })}
            </Box>
          )
        })}
      </Box>
      {!o.narrow && rows.length > 0 && (
        <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
          <Text bold color={P.text} backgroundColor={P.ground}>
            Subagents of this session
          </Text>
          {rows.slice(0, 6).map(r => (
            <Text key={r.id} color={P.muted} backgroundColor={P.ground}>
              {r.label} · {r.status} · {r.tools} tools{r.lastTool ? ` (${r.lastTool})` : ''} · {r.tokens.toLocaleString()} tok
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

let previous: Record<string, RunState> = {}
let isFirst = true

// One refresh of the background loop: reload, start queued items, report state changes and update the status line.
// The loop never runs two at once (see `ticking`).
async function tick($: EngineInterface) {
  const s = await refresh($)
  await drainQueue($, s)
  await sweepAgents($)
  const now: Record<string, RunState> = {}
  for (const r of s.runs) {
    now[r.slug] = r.state
    if (!isFirst && previous[r.slug] && previous[r.slug] !== r.state) {
      if (r.state === 'paused') await notify($, `${r.slug} is paused: ${stateLine(r, 0)}`)
      else if (r.state === 'failed' || r.state === 'stopped') await notify($, `${r.slug} failed at ${r.stage || 'start'}`)
      else if (r.state === 'done') await notify($, `${r.slug} is done`)
    }
  }
  previous = now
  isFirst = false
  const q = await read($, queue)
  const active = s.runs.filter(r => r.state === 'running' || r.state === 'starting' || r.state === 'paused')
  $.ui.status(active.length || q.length ? `sdlc ${summary(s.runs, q.length)}` : undefined)
}

let ticking = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sdlc-monitor', description: 'Open the SDLC control pane: start, watch, answer and stop pipelines' })
    await $.command.register({ name: 'sdlc-config', description: 'Open the CONFIG pane: providers and models of the model registry' })
    $.clock.every(SPIN_MS, async () => {
      // the frame turns while a button works and while any pipeline runs, so its card and stage box can spin
      const live = (await read($, snapshot)).runs.some(r => r.state === 'running' || r.state === 'starting')
      if (live || (await read($, busy)) || (await read($, working)) || (await read($, refreshing))) await update($, frame, n => n + 1)
    })
    $.clock.every(EVERY_MS, async () => {
      // a tick that is still running (a slow refresh, a start from the queue) is never joined by the next one
      if (ticking) return
      ticking = true
      try {
        await tick($)
      } finally {
        ticking = false
      }
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
          <Button key="config-open" label={labelOf(await read($, working), spinGlyph(await read($, frame)), 'config-open', 'CONFIG', 'Opening...')} onPress={() => openConfig($)} />
          <Text dimColor>{live.length || q.length ? summary(s.runs, q.length) : `${s.pending.length} pending`}</Text>
        </Box>
        {await feedback($, { Box, Text, Button })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    // the pane's full body height, so the dark ground fills it
    const tall = e.props.scroll?.bodyRows ?? 30
    const frameNo = await read($, frame)
    const now = await read($, working)
    const spinNow = spinGlyph(frameNo)
    const lbl = (key: string, text: string, doing: string) => labelOf(now, spinNow, key, text, doing)
    const s = await read($, snapshot)
    const current = await read($, view)
    const run = s.runs.find(r => r.slug === current)

    let detail: any = null

    // An item with no pipeline: never started, or just discarded.
    if (!run && current) {
      const item = s.pending.find(p => p.slug === current)
      const saved = s.discarded[current] ?? ''
      const pressedAt = (await read($, launching))[current]
      const isStarting = pressedAt !== undefined && s.now - pressedAt < LAUNCH_GRACE_MS
      // the ticket: Docs/backlog/<slug>/brief.md of the main working tree, read-only
      const brief = await readText($, await repoPath($, `Docs/backlog/${current}/brief.md`))

      detail = (
        <Box flexDirection="column" paddingX={1} gap={1} minHeight={tall} backgroundColor={P.ground}>
          <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
            <Button key="back" label="Close" onPress={() => update($, view, () => '')} />
            {isStarting ? (
              <Text color={P.run} backgroundColor={P.ground}>◌ Starting…</Text>
            ) : (
              <Button key="start" label={lbl('start', 'Start', 'Starting...')} variant="primary" onPress={() => startRun($, current)} />
            )}
          </Box>
          <Text bold color={P.text} backgroundColor={P.ground}>
            {current}  <Text color={P.muted} backgroundColor={P.ground}>not started</Text>
          </Text>
          {item && (
            <Text color={P.muted} backgroundColor={P.ground}>
              {item.type} {item.priority} · {cut(item.title, 80)}
            </Text>
          )}
          {saved && <Text color={P.muted} backgroundColor={P.ground}>Discarded. To get the old branch back: {saved}</Text>}
          <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
            <Text bold color={P.text} backgroundColor={P.ground}>Ticket (brief.md)</Text>
            {brief === null && <Text color={P.muted} backgroundColor={P.ground}>No brief.md found for this item.</Text>}
            {brief !== null &&
              brief.split('\n').map((line, i) => (
                <Text key={`brief-${i}`} bold={line.startsWith('#')} color={line.startsWith('#') ? P.strong : P.text} backgroundColor={P.ground}>
                  {line || ' '}
                </Text>
              ))}
          </Box>
        </Box>
      )
    }

    // One pipeline in detail.
    if (run) {
    const drafts = await read($, draft)
    const stopping = (await read($, confirmStop)) === run.slug
    const discarding = (await read($, confirmDiscard)) === run.slug
    const stages = stageStates(run)
    const claimShown = !!(await read($, showClaim))[run.slug]
    const done = stages.filter(x => x.state === 'done').length
    const since = run.agentStarted ? s.now - Date.parse(run.agentStarted) : 0
    const [tryNo, tryMax] = run.attempt.split('/').map(Number)
    const impls = run.files.filter(f => /^impl-\d+\.log$/.test(f)).length
    const answered = run.questions.filter(q => drafts[`${run.slug}:${q.n}`]).length
    const canStop = run.managed && (run.state === 'running' || run.state === 'starting')
    const canDiscard = run.managed
    // A paused run with nothing left to answer or decide (asks decided outside the pane) can only go on by resuming.
    const pausedIdle = run.state === 'paused' && run.questions.length === 0 && run.permissions.length === 0
    const canResume = run.managed && (run.state === 'failed' || run.state === 'interrupted' || run.state === 'stopped' || pausedIdle)

    detail = (
      <Box flexDirection="column" paddingX={1} gap={1} minHeight={tall} backgroundColor={P.ground}>
        <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
          <Button key="back" label="Close" onPress={() => update($, view, () => '')} />
          {canStop && (
            <Button
              key="stop"
              label={lbl('stop', stopping ? 'Confirm stop' : 'Stop', `Stopping ${run.slug}...`)}
              variant={stopping ? 'primary' : undefined}
              onPress={async () => {
                if (stopping) {
                  // the notice, the new buttons and the card's state come only once the pipeline is really gone
                  await act($, 'stop', `Stopping ${run.slug}`, async () => {
                    const err = await stopRun($, run.slug)
                    if (!err) await settled($, run.slug)
                    await update($, confirmStop, () => '')
                    await notify($, err ? `Could not stop ${run.slug}: ${err}` : `Stopped ${run.slug}.`)
                  })
                } else {
                  await update($, confirmStop, () => run.slug)
                }
              }}
            />
          )}
          {stopping && !now && <Button key="cancel-stop" label="Keep running" onPress={() => update($, confirmStop, () => '')} />}
          {canResume && (
            <Button
              key="resume"
              label={lbl('resume', resumeFrom(run) ? `Resume from ${resumeFrom(run) === 'implement' ? 'Implement' : run.stage}` : 'Resume', 'Resuming...')}
              variant="primary"
              onPress={() => act($, 'resume', `Resuming ${run.slug}`, () => launchWithNotice($, run.slug, resumeFrom(run)))}
            />
          )}
          {canDiscard && (
            <Button
              key="discard"
              label={lbl('discard', discarding ? 'Confirm discard' : 'Discard', 'Discarding...')}
              variant={discarding ? 'primary' : undefined}
              onPress={async () => {
                if (discarding) {
                  await act($, 'discard', `Discarding ${run.slug} (stopping it and deleting its worktree)`, async () => {
                    const err = await discardRun($, run.slug)
                    await update($, draft, d => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${run.slug}:`))))
                    await refresh($)
                    await update($, confirmDiscard, () => '')
                    await update($, confirmStop, () => '')
                    await notify($, err ? `Could not discard ${run.slug}: ${err}` : `Discarded ${run.slug}.`)
                  })
                } else {
                  await update($, confirmDiscard, () => run.slug)
                }
              }}
            />
          )}
          {discarding && !now && <Button key="cancel-discard" label="Keep it" onPress={() => update($, confirmDiscard, () => '')} />}
        </Box>

        {discarding && (
          <Text color={P.wait} backgroundColor={P.ground}>
            This deletes the worktree and branch sdlc/{run.slug} (unpushed work is lost; the branch tip is saved so it can be recovered). A running pipeline is stopped first.
          </Text>
        )}
        {!run.managed && (
          <Text color={P.wait} backgroundColor={P.ground}>Started outside the wrapper, so Stop and Resume are not available here. Resume it in the main working tree with ./scripts/sdlc.sh {run.slug}.</Text>
        )}
        {run.message && <Text color={P.fail} backgroundColor={P.ground}>{run.message}</Text>}
        {await feedback($, { Box, Text, Button })}
        {reasonBox($, { Box, Text, Button }, run)}

        <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
          <Text bold color={P.text} backgroundColor={P.ground}>
            {run.slug}  <Text color={COLOR[run.state]} backgroundColor={P.ground}>{run.state === 'stopped' ? 'stopped (process gone)' : run.state}</Text>
          </Text>
          <Text color={P.text} backgroundColor={P.ground}>
            {bar(done, stages.length, 30)} {done}/{stages.length} stages
          </Text>
        </Box>

        <Box flexWrap="wrap" gap={1} backgroundColor={P.ground}>
          {stages.map(st => (
            <Box key={`stage-${st.name}`} flexDirection="column" borderStyle="round" borderColor={STAGE_COLOR[st.state]} paddingX={1} backgroundColor={P.ground}>
              <Text color={STAGE_COLOR[st.state]} bold={st.state === 'active'} dimColor={st.state === 'pending'} backgroundColor={P.ground}>
                {st.state === 'active' ? spinGlyph(frameNo) : STAGE_GLYPH[st.state]} {st.name}
              </Text>
              {stageModel(run, st.name) && <Text color={P.muted} backgroundColor={P.ground}>{stageModel(run, st.name)}</Text>}
              {st.name === 'Test repair' && (run.claims.length > 0 || run.claimRejects.length > 0) && (
                <Button
                  key="show-claim"
                  label={claimShown ? 'Hide claim' : 'Show claim'}
                  onPress={() => update($, showClaim, m => ({ ...m, [run.slug]: !m[run.slug] }))}
                />
              )}
            </Box>
          ))}
        </Box>

        {claimShown && (
          <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
            <Text bold color={P.text} backgroundColor={P.ground}>
              Test repair claim <Text color={P.muted} backgroundColor={P.ground}>(Docs/backlog/{run.slug}/test-issues.md, written by the Implement agent)</Text>
            </Text>
            {run.claims.length === 0 && <Text color={P.muted} backgroundColor={P.ground}>test-issues.md is gone (Implement deletes it when it runs again).</Text>}
            {run.claims.map((c, i) => (
              <Box key={`claim-${i}`} flexDirection="column" backgroundColor={P.ground}>
                {c.file && <Text color={P.text} backgroundColor={P.ground}>{c.file} › {c.test}</Text>}
                <Text color={P.muted} backgroundColor={P.ground}>{'  '}{c.why}</Text>
              </Box>
            ))}
            {run.claimRejects.length > 0 && <Text bold color={P.fail} backgroundColor={P.ground}>Rejected by the pipeline</Text>}
            {run.claimRejects.map((l, i) => (
              <Text key={`reject-${i}`} color={P.fail} backgroundColor={P.ground}>{'  '}{l}</Text>
            ))}
          </Box>
        )}

        {Object.keys(run.stageFiles).length > 0 && (
          <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
            <Text bold color={P.text} backgroundColor={P.ground}>Files changed per stage</Text>
            {[...STAGES.filter(n => run.stageFiles[n]), ...Object.keys(run.stageFiles).filter(n => !STAGES.includes(n))].map(name => {
              const files = run.stageFiles[name]

              return (
                <Box key={`files-${name}`} flexDirection="column" backgroundColor={P.ground}>
                  <Text color={P.text} backgroundColor={P.ground}>
                    {name} <Text color={P.muted} backgroundColor={P.ground}>({files.length})</Text>
                  </Text>
                  {files.slice(0, FILES_SHOWN).map(f => (
                    <Text key={`file-${name}-${f}`} color={P.muted} backgroundColor={P.ground}>
                      {'  '}{cut(f, 100)}
                    </Text>
                  ))}
                  {files.length > FILES_SHOWN && <Text color={P.muted} backgroundColor={P.ground}>{'  '}+{files.length - FILES_SHOWN} more</Text>}
                </Box>
              )
            })}
          </Box>
        )}

        {run.state === 'running' && run.agent && (
          <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
            <Text bold color={P.text} backgroundColor={P.ground}>Agent</Text>
            <Text color={P.text} backgroundColor={P.ground}>
              <Text color={P.run} backgroundColor={P.ground}>{run.agent}</Text>
              {run.model && <Text color={P.text} backgroundColor={P.ground}>  {run.model} · {run.effort}</Text>}
              <Text color={P.muted} backgroundColor={P.ground}>  running {clock(since)}</Text>
            </Text>
            {tryMax > 0 && (
              <Text color={P.text} backgroundColor={P.ground}>
                attempt {bar(tryNo, tryMax, tryMax * 3)} {tryNo}/{tryMax}
              </Text>
            )}
          </Box>
        )}

        {run.changes && <Text color={P.text} backgroundColor={P.ground}>{`Files  ${run.changes.changed} changed since ${run.base || 'base'} · ${run.changes.uncommitted} uncommitted`}</Text>}

        {run.tests && (
          <Text color={P.text} backgroundColor={P.ground}>
            Tests {bar(run.tests.passed, run.tests.total, 24)} {run.tests.passed}/{run.tests.total} passing
            {run.tests.failed ? <Text color={P.fail} backgroundColor={P.ground}>  {run.tests.failed} failing</Text> : null}
          </Text>
        )}

        <Text color={P.text} backgroundColor={P.ground}>
          {['specs-1.md', 'plan-1.md', 'test-cases-1.md', 'review-1.md'].map(f => `${run.files.includes(f) ? '✔' : '○'} ${f.replace('-1.md', '')}`).join('   ')}
          {impls ? `   ⟳ impl ×${impls}` : ''}
        </Text>

        {canResume && (
          <Box flexDirection="column" gap={1} backgroundColor={P.ground}>
            <Text bold color={P.text} backgroundColor={P.ground}>Manual input per stage (type, press Enter to save; saving an empty line clears it)</Text>
            {INPUT_STAGES.map(st => (
              <Box key={`input-${st.key}`} gap={1} flexWrap="wrap" backgroundColor={P.ground}>
                <Text color={P.text} backgroundColor={P.ground}>{st.label}</Text>
                <Input key={`in-${st.key}`} placeholder={`instructions for the ${st.label} agent`} onSubmit={value => saveManualInput($, run, st.key, value)} />
                <Button
                  key={`resume-at-${st.key}`}
                  label={lbl(`resume-at-${st.key}`, `Resume at ${st.label}`, `Resuming at ${st.label}...`)}
                  onPress={() => act($, `resume-at-${st.key}`, `Resuming ${run.slug} at ${st.label}`, () => launchWithNotice($, run.slug, st.key === 'spec' ? '' : st.key))}
                />
              </Box>
            ))}
          </Box>
        )}

        {run.state === 'paused' && run.questions.length > 0 && (
          <Box flexDirection="column" gap={1} backgroundColor={P.ground}>
            <Text bold color={P.wait} backgroundColor={P.ground}>
              {answered}/{run.questions.length} questions answered
            </Text>
            {run.questions.map(q => {
              const key = `${run.slug}:${q.n}`

              return (
                <Box key={`q-${q.n}`} flexDirection="column" backgroundColor={P.ground}>
                  <Text bold color={P.text} backgroundColor={P.ground}>
                    Q{q.n}: {q.title}
                  </Text>
                  {q.body && <Text color={P.muted} backgroundColor={P.ground}>{q.body}</Text>}
                  <Text color={P.text} backgroundColor={P.ground}>
                    Suggested: <Text color={P.done} backgroundColor={P.ground}>{q.suggested}</Text>
                  </Text>
                  <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
                    <Button key={`use-${key}`} label="Use suggested" onPress={() => update($, draft, d => ({ ...d, [key]: 'accept' }))} />
                    <Input
                      key={`ans-${key}`}
                      placeholder="or type your own answer, then Enter"
                      onSubmit={value => update($, draft, d => ({ ...d, [key]: value.trim() }))}
                    />
                  </Box>
                  {drafts[key] && (
                    <Text color={P.run} backgroundColor={P.ground}>
                      → {drafts[key] === 'accept' ? 'accept suggested' : drafts[key]}
                    </Text>
                  )}
                </Box>
              )
            })}
            {answered === run.questions.length ? (
              <Button key="submit-answers" label={lbl('submit-answers', 'Submit answers and resume', 'Saving...')} variant="primary" onPress={() => submitAnswers($, run)} />
            ) : (
              <Text color={P.muted} backgroundColor={P.ground}>Answer every question to resume.</Text>
            )}
          </Box>
        )}
        {run.state === 'paused' && run.permissions.length > 0 && (
          <Box flexDirection="column" gap={1} backgroundColor={P.ground}>
            <Text bold color={P.wait} backgroundColor={P.ground}>
              The {run.permissions[0].stage} agent was refused {run.permissions.length} action(s). Allow or deny each; the stage restarts when none is left.
            </Text>
            {run.permissions.map((a, i) => (
              <Box key={`perm-${i}`} flexDirection="column" backgroundColor={P.ground}>
                <Text color={P.text} backgroundColor={P.ground}>
                  {a.tool}: {cut(a.detail, 90)}
                </Text>
                {a.protected && <Text color={P.muted} backgroundColor={P.ground}>Protected path: allowing it runs the whole {a.stage} stage with permission checks off.</Text>}
                <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
                  <Button key={`perm-allow:${i}`} label={lbl(`perm-allow:${i}`, a.protected ? 'Allow (stage runs unchecked)' : `Allow this run (${cut(a.rule, 40)})`, 'Saving...')} variant="primary" onPress={() => decidePermission($, run, String(i), 'allow')} />
                  {!a.protected && <Button key={`perm-always:${i}`} label={lbl(`perm-always:${i}`, 'Allow always', 'Saving...')} onPress={() => decidePermission($, run, String(i), 'always')} />}
                  <Button key={`perm-deny:${i}`} label={lbl(`perm-deny:${i}`, 'Deny', 'Saving...')} onPress={() => decidePermission($, run, String(i), 'deny')} />
                </Box>
              </Box>
            ))}
            {run.permissions.length > 1 && (
              <Box gap={1} backgroundColor={P.ground}>
                <Button key="perm-allow-all" label={lbl('perm-allow:all', 'Allow all', 'Saving...')} onPress={() => decidePermission($, run, 'all', 'allow')} />
                <Button key="perm-deny-all" label={lbl('perm-deny:all', 'Deny all', 'Saving...')} onPress={() => decidePermission($, run, 'all', 'deny')} />
              </Box>
            )}
          </Box>
        )}
        {pausedIdle && <Text color={P.wait} backgroundColor={P.ground}>Paused at {run.stage || 'start'} with nothing left to answer or decide: press Resume to continue (or check Docs/backlog/{run.slug}/questions.md).</Text>}

        <Box flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
          <Text bold color={P.text} backgroundColor={P.ground}>Recent output</Text>
          {run.tail.length === 0 && <Text color={P.muted} backgroundColor={P.ground}>No output yet.</Text>}
          {run.tail.map((line, i) => (
            <Text key={`tail-${i}`} color={P.muted} backgroundColor={P.ground}>
              {cut(line, 100)}
            </Text>
          ))}
        </Box>
      </Box>
    )
    }

    const wide = e.props.bodyColumns ?? 400
    const isOpen = detail !== null
    const boardW = isOpen ? Math.floor(wide * (1 - DETAIL_SHARE)) : wide
    const board = await boardView($, { Box, Text, Button }, s, { width: boardW, current, narrow: isOpen })

    return (
      <Box flexDirection="row" minHeight={tall} backgroundColor={P.ground}>
        {board}
        {isOpen && (
          <Box flexDirection="column" width={wide - boardW} borderStyle="single" borderColor={P.line} backgroundColor={P.ground}>
            {detail}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: CONFIG_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    // the pane's full body height, so the dark ground fills it
    const tall = e.props.scroll?.bodyRows ?? 30
    const now = await read($, working)
    const spinNow = spinGlyph(await read($, frame))
    const lbl = (key: string, text: string, doing: string) => labelOf(now, spinNow, key, text, doing)
    const view = await read($, configView)
    const editing = await read($, configEditing)
    const form = await read($, configForm)

    if (view === 'form') {
      return (
        <Box flexDirection="column" paddingX={1} gap={1} minHeight={tall} backgroundColor={P.ground}>
          <Text bold color={P.text} backgroundColor={P.ground}>{editing ? `Edit ${editing}` : 'Add a provider'}</Text>
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
          <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
            <Button
              key="config-effort"
              label={form.effort ? 'Effort flag: on' : 'Effort flag: off'}
              onPress={() => update($, configForm, d => ({ ...d, effort: !d.effort }))}
            />
            <Text color={P.muted} backgroundColor={P.ground}>models: comma list; the effort flag passes --effort, which many models reject</Text>
          </Box>
          <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
            <Button key="config-save" label={lbl('config-save', 'Save', 'Saving...')} variant="primary" onPress={() => saveForm($, false)} />
            {!editing && <Button key="config-save-another" label={lbl('config-save-another', 'Save and add another', 'Saving...')} onPress={() => saveForm($, true)} />}
            <Button key="config-cancel" label={lbl('config-cancel', 'Cancel', 'Loading...')} onPress={() => showList($)} />
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
      <Box flexDirection="column" paddingX={1} gap={1} minHeight={tall} backgroundColor={P.ground}>
        <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
          <Text bold color={P.text} backgroundColor={P.ground}>CONFIG</Text>
          <Button key="config-add-new" label="Add provider" variant="primary" onPress={() => showForm($, '')} />
        </Box>
        {await feedback($, { Box, Text, Button })}
        {error ? <Text color={P.fail} backgroundColor={P.ground}>{error}</Text> : null}
        {!error && list && names.length === 0 && <Text color={P.muted} backgroundColor={P.ground}>No custom providers</Text>}
        {!error &&
          list &&
          names.map(name => {
            const p = list[name]
            const removing = pendingProvider === name

            return (
              <Box key={`config-provider:${name}`} flexDirection="column" borderStyle="single" borderColor={P.line} paddingX={1} backgroundColor={P.ground}>
                <Box gap={1} flexWrap="wrap" backgroundColor={P.ground}>
                  <Text bold color={P.text} backgroundColor={P.ground}>{name}</Text>
                  <Text color={P.muted} backgroundColor={P.ground}>{p.endpoint}</Text>
                  <Text color={P.muted} backgroundColor={P.ground}>{p.api_key_env}</Text>
                  <Text color={p.key_set ? 'green' : 'yellow'} backgroundColor={P.ground}>{p.key_set ? 'key set' : 'key NOT set'}</Text>
                  <Button key={`config-edit:${name}`} label="Edit" onPress={() => showForm($, name)} />
                  <Button
                    key={`config-remove-provider:${name}`}
                    label={lbl(`config-remove-provider:${name}`, removing ? 'Confirm remove' : 'Remove', 'Removing...')}
                    variant={removing ? 'primary' : undefined}
                    onPress={async () => {
                      if (removing) await removeProvider($, name)
                      else await update($, configConfirmProvider, () => name)
                    }}
                  />
                  {removing && !now && <Button key="config-keep-provider" label="Keep it" onPress={() => update($, configConfirmProvider, () => '')} />}
                </Box>
                {p.models.map(model => {
                  const removingModel = pendingModel?.provider === name && pendingModel.model === model

                  return (
                    <Box key={`config-model:${name}/${model}`} gap={1} flexWrap="wrap" paddingLeft={2} backgroundColor={P.ground}>
                      <Text color={P.text} backgroundColor={P.ground}>{model}</Text>
                      <Button key={`config-test:${name}/${model}`} label={lbl(`config-test:${name}/${model}`, 'Test', 'Testing...')} onPress={() => testModel($, name, model)} />
                      <Button
                        key={`config-remove-model:${name}/${model}`}
                        label={lbl(`config-remove-model:${name}/${model}`, removingModel ? 'Confirm remove' : 'Remove', 'Removing...')}
                        variant={removingModel ? 'primary' : undefined}
                        onPress={async () => {
                          if (removingModel) await removeModel($, name, model)
                          else await update($, configConfirmModel, () => ({ provider: name, model }))
                        }}
                      />
                      {removingModel && !now && <Button key="config-keep-model" label="Keep it" onPress={() => update($, configConfirmModel, () => null)} />}
                    </Box>
                  )
                })}
                {p.effort && <Text color={P.muted} backgroundColor={P.ground}>effort</Text>}
              </Box>
            )
          })}
      </Box>
    )
  })
}

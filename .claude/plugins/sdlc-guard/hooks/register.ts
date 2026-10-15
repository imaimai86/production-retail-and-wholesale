import type { EngineInterface, Register } from 'claude-code'

type Phase = { stage: string; slug: string }
// Where tests, source and backlog live (scripts/sdlc-config.cjs layout); paths are from the project root.
type Layout = { root: string; backlogDir: string; tests: RegExp[]; testFiles: string; sourceDirs: string[] }

// This repository's layout, used when the project settings cannot be read.
const FALLBACK: Layout = { root: '', backlogDir: 'Docs/backlog', tests: [/^server\/__tests__\//], testFiles: 'server/__tests__/', sourceDirs: ['server'] }
const WRITERS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const BASH_WRITE = /(\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b|>|\bgit\s+(checkout|restore|apply)\b)/
// state-file phase names (sdlc-guard.cjs set <phase>) to the stage names status.json uses
const STATE_PHASE: Record<string, string> = { implement: 'Implement', review: 'Review' }

async function projectLayout($: EngineInterface): Promise<Layout> {
  try {
    const r = await $.process.run(['node', 'scripts/sdlc-config.cjs', 'layout'])
    const l = JSON.parse(r.stdout)

    if (r.exitCode !== 0 || !Array.isArray(l.testPatterns)) return FALLBACK

    return { root: l.root, backlogDir: l.backlogDir, tests: l.testPatterns.map((x: string) => new RegExp(x)), testFiles: l.testFiles, sourceDirs: l.sourceDirs }
  } catch {
    return FALLBACK
  }
}

// A path as a path from the project root (tools may pass absolute paths). Without a known root (the settings could not
// be read), an absolute path is matched from its server/ folder on, as this repository's guard always did.
function fromRoot(l: Layout, path: string): string {
  if (l.root && path.startsWith(`${l.root}/`)) return path.slice(l.root.length + 1)
  if (!l.root) {
    const i = path.indexOf('/server/')

    if (i >= 0) return path.slice(i + 1)
  }

  return path.replace(/^\.\//, '')
}

// The running stage, as scripts/sdlc.sh reports it in status.json (a live pid
// only), else the phase the /implement and /review commands set in sdlc-state.json.
async function activePhase($: EngineInterface, backlogDir: string): Promise<Phase | null> {
  let best: (Phase & { updated: string }) | null = null
  let dirs: { name: string; kind: string }[] = []
  try {
    dirs = await $.fs.list(backlogDir)
  } catch {
    dirs = []
  }
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    try {
      const s = JSON.parse((await $.fs.read(`${backlogDir}/${d.name}/logs/status.json`)) as string)
      if (s.state !== 'running' || (best && s.updated <= best.updated)) continue
      const live = await $.process.run(['kill', '-0', String(s.pid)])
      if (live.exitCode === 0) best = { stage: s.stage, slug: s.slug, updated: s.updated }
    } catch {
      // no status file, or its process is gone
    }
  }
  if (best) return best
  try {
    const s = JSON.parse((await $.fs.read('.claude/sdlc-state.json')) as string)
    const stage = STATE_PHASE[s.phase]

    return stage ? { stage, slug: s.slug } : null
  } catch {
    return null
  }
}

// Why a write to `path` (from the project root) is refused in this stage, or undefined when it is fine.
function refuse(p: Phase, path: string, l: Layout): string | undefined {
  const isTest = l.tests.some(re => re.test(path))
  const isOwnDoc = path.startsWith(`${l.backlogDir}/${p.slug}/`) || path.includes(`/${l.backlogDir}/${p.slug}/`)
  const inSuite = l.sourceDirs.some(d => d === '.' || path.startsWith(`${d}/`))
  const isSource = inSuite && !isTest && !path.startsWith(`${l.backlogDir}/`)

  switch (p.stage) {
    case 'Spec':
    case 'Plan':
      return isOwnDoc ? undefined : `${p.stage}: only ${l.backlogDir}/${p.slug}/ may be written.`
    case 'Red tests':
      return isOwnDoc || isTest ? undefined : 'Red tests: write tests and docs only, never source.'
    case 'Test repair':
      return isSource ? 'Test repair: source files are read-only.' : undefined
    case 'Implement':
    case 'Review':
      return isTest ? `${p.stage}: the tests (${l.testFiles}) are read-only. Fix the source, not the tests. If a test is truly wrong, record it in test-issues.md.` : undefined
    default:
      return undefined
  }
}

async function missingPrereq($: EngineInterface, p: Phase, path: string, l: Layout): Promise<string | undefined> {
  const needs: Record<string, string> = { 'plan-1.md': 'specs-1.md', 'test-cases-1.md': 'plan-1.md' }
  const file = path.split('/').pop() ?? ''
  const need = needs[file]

  if (!need || !path.includes(`${l.backlogDir}/${p.slug}/`)) return undefined

  return (await $.fs.exists(`${l.backlogDir}/${p.slug}/${need}`)) ? undefined : `${file} needs ${need} first: run the stages in order.`
}

// A guard that cannot decide refuses: a crashed check must not become an open door.
const FAILED = { deny: 'sdlc-guard: could not check the SDLC stage, so the call is refused. Retry, or clear the stage state.' }

export const register: Register = on => {
  for (const tool of WRITERS) {
    on('tool.call', { tool }, async ($, e, next) => {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const l = await projectLayout($)
      const path = fromRoot(l, (input.file_path ?? input.notebook_path ?? '').replace(/\\/g, '/'))
      const phase = await activePhase($, l.backlogDir)

      if (!phase || !path) return next(e)
      const why = refuse(phase, path, l) ?? (await missingPrereq($, phase, path, l))

      return why ? { deny: `sdlc-guard: ${why}` } : next(e)
    }).catch(() => FAILED)
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const l = await projectLayout($)
    const phase = await activePhase($, l.backlogDir)
    const isLocked = phase && (phase.stage === 'Implement' || phase.stage === 'Review')
    const command = (e as unknown as { command?: string }).command ?? ''
    // a word of the command that is a test file, or a test folder
    const words = command.split(/[\s;&|<>()'"]+/).filter(Boolean).map(w => fromRoot(l, w).replace(/\/+$/, ''))
    const touchesTests = words.some(w => l.tests.some(re => re.test(w) || re.test(`${w}/`)))

    if (isLocked && touchesTests && BASH_WRITE.test(command)) {
      return { deny: `sdlc-guard: ${phase.stage}: the tests (${l.testFiles}) are read-only. Fix the source, not the tests.` }
    }

    return next(e)
  }).catch(() => FAILED)
}

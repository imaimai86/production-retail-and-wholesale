import type { EngineInterface, Register } from 'claude-code'

type Phase = { stage: string; slug: string }

const TESTS = /(^|\/)server\/__tests__\//
const SERVER = /(^|\/)server\//
const WRITERS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const BASH_WRITE = /(\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b|>|\bgit\s+(checkout|restore|apply)\b)/
// state-file phase names (sdlc-guard.cjs set <phase>) to the stage names status.json uses
const STATE_PHASE: Record<string, string> = { implement: 'Implement', review: 'Review' }

// The running stage, as scripts/sdlc.sh reports it in status.json (a live pid
// only), else the phase the /implement and /review commands set in sdlc-state.json.
async function activePhase($: EngineInterface): Promise<Phase | null> {
  let best: (Phase & { updated: string }) | null = null
  let dirs: { name: string; kind: string }[] = []
  try {
    dirs = await $.fs.list('Docs/backlog')
  } catch {
    dirs = []
  }
  for (const d of dirs) {
    if (d.kind !== 'dir') continue
    try {
      const s = JSON.parse((await $.fs.read(`Docs/backlog/${d.name}/logs/status.json`)) as string)
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

// Why a write to `path` is refused in this stage, or undefined when it is fine.
function refuse(p: Phase, path: string): string | undefined {
  const isTest = TESTS.test(path)
  const isSource = SERVER.test(path) && !isTest
  const isOwnDoc = path.includes(`Docs/backlog/${p.slug}/`)

  switch (p.stage) {
    case 'Spec':
    case 'Plan':
      return isOwnDoc ? undefined : `${p.stage}: only Docs/backlog/${p.slug}/ may be written.`
    case 'Red tests':
      return isOwnDoc || isTest ? undefined : 'Red tests: write tests and docs only, never source.'
    case 'Test repair':
      return isSource ? 'Test repair: source files are read-only.' : undefined
    case 'Implement':
    case 'Review':
      return isTest ? `${p.stage}: server/__tests__ is read-only. Fix the source, not the tests. If a test is truly wrong, record it in test-issues.md.` : undefined
    default:
      return undefined
  }
}

async function missingPrereq($: EngineInterface, p: Phase, path: string): Promise<string | undefined> {
  const needs: Record<string, string> = { 'plan-1.md': 'specs-1.md', 'test-cases-1.md': 'plan-1.md' }
  const file = path.split('/').pop() ?? ''
  const need = needs[file]

  if (!need || !path.includes(`Docs/backlog/${p.slug}/`)) return undefined

  return (await $.fs.exists(`Docs/backlog/${p.slug}/${need}`)) ? undefined : `${file} needs ${need} first: run the stages in order.`
}

// A guard that cannot decide refuses: a crashed check must not become an open door.
const FAILED = { deny: 'sdlc-guard: could not check the SDLC stage, so the call is refused. Retry, or clear the stage state.' }

export const register: Register = on => {
  for (const tool of WRITERS) {
    on('tool.call', { tool }, async ($, e, next) => {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const path = (input.file_path ?? input.notebook_path ?? '').replace(/\\/g, '/')
      const phase = await activePhase($)

      if (!phase || !path) return next(e)
      const why = refuse(phase, path) ?? (await missingPrereq($, phase, path))

      return why ? { deny: `sdlc-guard: ${why}` } : next(e)
    }).catch(() => FAILED)
  }

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const phase = await activePhase($)
    const isLocked = phase && (phase.stage === 'Implement' || phase.stage === 'Review')
    const command = (e as unknown as { command?: string }).command ?? ''

    if (isLocked && /__tests__/.test(command) && BASH_WRITE.test(command)) {
      return { deny: `sdlc-guard: ${phase.stage}: server/__tests__ is read-only. Fix the source, not the tests.` }
    }

    return next(e)
  }).catch(() => FAILED)
}

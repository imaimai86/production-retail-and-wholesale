import { test, expect, mock } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T10:03:12')
const WT = '/wt'

type RunSpec = {
  slug: string
  state?: string
  stage?: string
  agent?: string
  attempt?: string
  alive?: boolean
  interrupted?: boolean
  questions?: string
  testsLog?: string
  files?: string[]
  exitCode?: string
  message?: string
  // logs/stage-files.json: files each stage changed
  stageFiles?: Record<string, string[]>
  // text of logs/plan.log (list it in `files` too)
  planLog?: string
  // logs/permissions.json: the actions the agent was refused and nobody decided yet
  permissions?: { stage: string; tool: string; detail: string; rule: string; protected: boolean }[]
  // makes the wrapper's stop command fail with this stderr
  stopError?: string
  // makes the wrapper's background start fail with this stderr
  launchError?: string
  // a pipeline started by hand: no wrapper record, only a status.json in the main working tree
  legacy?: boolean
  // what `sdlc-mod.sh changes <slug> --json` reports; null makes the command fail (discarded run, worktree gone)
  changes?: { changed: number; uncommitted: number } | null
  // the base branch in the run record
  base?: string
  // status.json note: why a running pipeline waits (usage limit)
  note?: string
}

const QUESTIONS = [
  '# Questions',
  '### Q1: Error shape',
  'Which JSON body for a missing name?',
  '**Suggested:** { "error": "name is required" }',
  '**Answer:**',
  '### Q2: Status code',
  'Which status code?',
  '**Suggested:** 400',
  '**Answer:**',
  '',
].join('\n')

const PENDING = [
  { status: 'pending', slug: 'one', type: 'bug', priority: 'P1', title: 'Fix the first thing' },
  { status: 'pending', slug: 'two', type: 'feature', priority: 'P2', title: 'Add the second thing' },
  { status: 'pending', slug: 'three', type: 'feature', priority: 'P3', title: 'Add the third thing' },
]

// A repo with the given pipelines recorded, and every process call captured.
type ModelReply = { exitCode?: number; stdout?: string; stderr?: string } | undefined

// A test can hold the wrapper's stop / discard call open to look at the pane while it works.
const repoTop = { value: '' }
const gate: { wait: Promise<void> } = { wait: Promise.resolve() }
// the same for the wrapper's `changes --all` count, held open to look at the Refresh button while it works
const countGate: { wait: Promise<void> } = { wait: Promise.resolve() }

function world(on: any, runs: RunSpec[] = [], model?: (argv: string[]) => ModelReply | Promise<ModelReply>) {
  const opens: { id: string; title: string }[] = []
  const toasts: string[] = []
  const copies: string[] = []
  const calls: string[][] = []
  const envs: Record<string, string>[] = []
  const writes: { path: string; text: string }[] = []
  const file = (name: string) => ({ name, kind: 'file', size: 1 })
  // slugs the wrapper stopped: their process is gone
  const stopped = new Set<string>()
  const pidOf = (r: RunSpec) => (r.alive === false || stopped.has(r.slug) ? 999 : 100)
  // slugs whose run record the wrapper has deleted (discard); revive() brings one back, as a new start would
  const gone = new Set<string>()
  // how many one-by-one `permit` calls were made, so the stub can answer how many asks are left
  let decided = 0

  const clock = mock.clock(on, { now: NOW })
  on('fs.list', (_: unknown, e: { path: string }) => {
    if (e.path.endsWith('.git/sdlc-runs')) {
      return { value: [...runs.filter(r => !r.legacy && !gone.has(r.slug)).map(r => file(`${r.slug}.json`)), ...[...gone].map(g => file(`${g}.discarded`))] }
    }
    if (/(^|\/)Docs\/backlog$/.test(e.path)) return { value: runs.filter(r => r.legacy).map(r => ({ name: r.slug, kind: 'dir', size: 0 })) }
    for (const r of runs) {
      if (e.path.endsWith(`${r.slug}/logs`)) return { value: (r.files ?? []).filter(f => f.endsWith('.log')).map(file) }
      if (e.path.endsWith(`Docs/backlog/${r.slug}`)) return { value: (r.files ?? []).filter(f => f.endsWith('.md')).map(file) }
    }

    return { value: [] }
  })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (e.path.endsWith('Docs/backlog/one/brief.md')) return { value: '# one\n\nType: bug\nFix the first thing in detail.\n' }
    for (const g of gone) if (e.path.endsWith(`sdlc-runs/${g}.discarded`)) return { value: `git branch sdlc/${g} abc123\n` }
    for (const r of runs) {
      if (gone.has(r.slug)) continue
      if (e.path.endsWith(`sdlc-runs/${r.slug}.json`)) {
        return {
          value: JSON.stringify({
            slug: r.slug, worktree: WT, pid: pidOf(r), started: '2026-10-06T10:00:00',
            state: r.exitCode ? 'exited' : 'running', exit_code: r.exitCode ?? '', interrupted: r.interrupted === true, message: r.message ?? '',
            ...(r.base ? { base: r.base } : {}),
          }),
        }
      }
      if (e.path.endsWith(`${r.slug}/logs/status.json`) && r.state) {
        return {
          value: JSON.stringify({
            slug: r.slug, state: r.state, stage: r.stage ?? '', agent: r.agent ?? '', model: 'opus', effort: 'medium',
            models: { implement: { model: 'sonnet', effort: 'medium' }, 'test-repair': { model: 'sonnet', effort: 'low' }, 'test-audit': { model: 'opus', effort: 'high' } }, attempt: r.attempt ?? '',
            agent_started: '2026-10-06T10:00:00', run_started: '2026-10-06T09:50:00', updated: '2026-10-06T10:03:00', pid: pidOf(r), note: r.note ?? '',
          }),
        }
      }
      if (e.path.endsWith(`${r.slug}/logs/stage-files.json`) && r.stageFiles) return { value: JSON.stringify({ stages: r.stageFiles }) }
      if (e.path.endsWith(`${r.slug}/logs/permissions.json`) && r.permissions) return { value: JSON.stringify({ pending: r.permissions, allow: [], bypass: [], denied: [] }) }
      if (e.path.endsWith(`${r.slug}/logs/plan.log`) && r.planLog) return { value: r.planLog }
      if (e.path.endsWith(`${r.slug}/logs/tests.log`) && r.testsLog) return { value: r.testsLog }
      if (e.path.endsWith(`${r.slug}/logs/run.out`)) return { value: '== Implement\n   -> agent: impl-2\n' }
      if (e.path.endsWith(`${r.slug}/questions.md`) && r.questions) return { value: r.questions }
    }

    return { deny: 'ENOENT' }
  })
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    writes.push({ path: e.path, text: e.text })

    return { value: undefined } as never
  })
  on('process.run', async (_: unknown, e: { argv: string[]; init?: { env?: Record<string, string> } }) => {
    calls.push([...e.argv])
    if (e.argv[2] === 'discard') gone.add(e.argv[3])
    envs.push(e.init?.env ?? {})
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false } })
    if (e.argv[1] === '-c') {
      const bad = runs.find(r => r.slug === e.argv[e.argv.length - 1] && r.launchError)
      if (bad) return { value: { exitCode: 1, stdout: '', stderr: bad.launchError, isStdoutTruncated: false } }
    }
    if (e.argv[2] === 'stop' || e.argv[2] === 'discard') await gate.wait
    if (e.argv[2] === 'stop') {
      const bad = runs.find(r => r.slug === e.argv[3] && r.stopError)
      if (bad) return { value: { exitCode: 3, stdout: '', stderr: `${bad.stopError}\n`, isStdoutTruncated: false } }
      stopped.add(e.argv[3])
    }
    if (e.argv[2] === 'permit') {
      const n = runs.find(r => r.slug === e.argv[3])?.permissions?.length ?? 0
      decided += 1

      return out(e.argv[5] === 'all' ? '0' : String(Math.max(0, n - decided)))
    }
    if (e.argv[0] === 'git') return out(e.argv.includes('--git-common-dir') && repoTop.value ? `${repoTop.value}/.git\n` : '.git\n')
    if (e.argv[0] === 'node') return out(JSON.stringify(PENDING))
    if (e.argv[0] === 'kill') return out('', e.argv[2] === '100' ? 0 : 1)
    if (e.argv[1] === 'scripts/sdlc-mod.sh' && e.argv[2] === 'changes' && e.argv[3] === '--all') {
      await countGate.wait
      const counted: Record<string, unknown> = {}
      for (const slug of e.argv.slice(4)) {
        const c = runs.find(r => r.slug === slug)?.changes
        counted[slug] = c ? { changed: c.changed, uncommitted: c.uncommitted } : { error: `Worktree for ${slug} is gone` }
      }

      return out(JSON.stringify({ runs: counted }))
    }

    if (model && e.argv[1] === 'scripts/sdlc-mod.sh' && e.argv[2] === 'model') {
      const r = await model(e.argv.slice(3))
      if (r) return { value: { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false } }
    }

    return out('')
  })
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', (_: unknown, e: { id: string; title: string }) => {
    opens.push({ id: e.id, title: e.title })

    return { value: { isPlaced: true } } as never
  })
  on('ui.copy', (_: unknown, e: { text: string }) => {
    copies.push(e.text)

    return { value: { isCopied: true } } as never
  })
  on('ui.toast', (_: unknown, e: { message?: string; text?: string }) => {
    toasts.push(String(e.message ?? e.text ?? ''))

    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)

  return { calls, envs, writes, opens, toasts, copies, clock, revive: (slug: string) => gone.delete(slug) }
}

async function open($: any) {
  await $.command.run({ command: 'sdlc-monitor', args: '' })

  return $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'Pane', requestId: 'sdlc', props: {} })
}

const launches = (calls: string[][]) => calls.filter(c => c[0] === 'bash' && c[1] === '-c').map(c => c[c.length - 1])
// the `changes --all <slug>...` calls that counted `slug`
const changesCalls = (calls: string[][], slug: string) => calls.filter(c => c[2] === 'changes' && c[3] === '--all' && c.slice(4).includes(slug))
const stops = (calls: string[][]) => calls.filter(c => c[0] === 'bash' && c[2] === 'stop').map(c => c[3])
const text = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

test('overview lists the pending items and selecting toggles the checkbox', async ($, on) => {
  world(on)
  const ui = await open($)

  expect(await text(ui, /one/)).toBeDefined()
  expect((await ui.find({ key: 'sel-one' }))?.props.label).toBe('[ ] one')
  await ui.press({ key: 'sel-one' })
  expect((await ui.find({ key: 'sel-one' }))?.props.label).toBe('[x] one')
  expect((await ui.find({ key: 'run-selected' }))?.props.label).toBe('Run selected (1)')
  await ui.press({ key: 'sel-one' })
  expect((await ui.find({ key: 'sel-one' }))?.props.label).toBe('[ ] one')
  await ui.unmount()
})

test('Run selected starts each pipeline detached through the wrapper', async ($, on) => {
  const w = world(on)
  const ui = await open($)
  await ui.press({ key: 'sel-one' })
  await ui.press({ key: 'run-selected' })

  const cmd = w.calls.find(c => c[1] === '-c')!
  expect(cmd[2]).toContain('nohup bash "${SDLC_WRAPPER:-scripts/sdlc-mod.sh}" run "$0"')
  expect(cmd[2]).toContain('&')
  expect(cmd[cmd.length - 1]).toBe('one')
  expect(w.envs[w.calls.indexOf(cmd)].SDLC_MAX_PARALLEL).toBe('2')
  await ui.unmount()
})

test('three selected with two slots: two start, the third waits in the queue', async ($, on) => {
  const w = world(on)
  const ui = await open($)
  for (const slug of ['one', 'two', 'three']) await ui.press({ key: `sel-${slug}` })
  await ui.press({ key: 'run-selected' })

  expect(launches(w.calls)).toEqual(['one', 'two'])
  expect(await text(ui, /three queued/)).toBeDefined()
  await ui.unmount()
})

test('with one pipeline already running only one more starts', async ($, on) => {
  const w = world(on, [{ slug: 'busy', state: 'running', stage: 'Implement', agent: 'impl-1', attempt: '1/4' }])
  const ui = await open($)
  for (const slug of ['one', 'two']) await ui.press({ key: `sel-${slug}` })
  await ui.press({ key: 'run-selected' })

  expect(launches(w.calls)).toEqual(['one'])
  expect(await text(ui, /two queued/)).toBeDefined()
  await ui.unmount()
})

test('a running pipeline shows stages, agent, attempt and test progress', async ($, on) => {
  world(on, [{
    slug: 'alpha', state: 'running', stage: 'Implement', agent: 'impl-2', attempt: '2/4',
    files: ['specs-1.md', 'plan-1.md', 'test-cases-1.md', 'impl-1.log', 'impl-2.log'],
    testsLog: 'Tests:       5 failed, 15 passed, 20 total\n',
  }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /^alpha\s+running/)).toBeDefined()
  expect(await text(ui, /3\/6 stages/)).toBeDefined()
  expect(await text(ui, /^impl-2\s+opus/)).toMatch(/03:12/) // the agent line, not the board card
  expect(await text(ui, /attempt/)).toMatch(/2\/4/)
  expect(await text(ui, /opus · medium\s+running/)).toBeDefined() // the running agent's model and effort
  expect(await text(ui, /sonnet · medium/)).toBeDefined() // the Implement stage box
  expect(await text(ui, /Tests/)).toMatch(/15\/20 passing/)
  expect(await text(ui, /impl ×2/)).toBeDefined()
  expect(await text(ui, /agent: impl-2/)).toBeDefined()
  await ui.unmount()
})

test('a paused pipeline shows its questions; answers are written and the pipeline resumes', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Spec', questions: QUESTIONS }])
  const ui = await open($)
  expect((await ui.find({ key: 'open-alpha' }))?.props.label).toMatch(/^⏸ alpha/) // the board card
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /0\/2 questions answered/)).toBeDefined()
  expect(await text(ui, /Q1: Error shape/)).toBeDefined()
  expect(await text(ui, /Suggested:.*name is required/)).toBeDefined()
  expect(await ui.find({ key: 'submit-answers' })).toBeUndefined()

  await ui.press({ key: 'use-alpha:1' })
  await ui.input({ key: 'ans-alpha:2', text: '422' })
  expect(await text(ui, /2\/2 questions answered/)).toBeDefined()

  await ui.press({ key: 'submit-answers' })
  expect(w.writes).toHaveLength(1)
  expect(w.writes[0].path).toBe('/wt/Docs/backlog/alpha/questions.md')
  expect(w.writes[0].text).toContain('**Answer:** accept')
  expect(w.writes[0].text).toContain('**Answer:** 422')
  expect(launches(w.calls)).toEqual(['alpha'])
  await ui.unmount()
})

test('Stop needs a second press, and Keep running cancels it', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'running', stage: 'Plan', agent: 'plan' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  await ui.press({ key: 'stop' })
  expect(stops(w.calls)).toEqual([])
  expect((await ui.find({ key: 'stop' }))?.props.label).toBe('Confirm stop')

  await ui.press({ key: 'cancel-stop' })
  expect((await ui.find({ key: 'stop' }))?.props.label).toBe('Stop')
  expect(stops(w.calls)).toEqual([])

  await ui.press({ key: 'stop' })
  await ui.press({ key: 'stop' })
  expect(stops(w.calls)).toEqual(['alpha'])
  await ui.unmount()
})

test('an interrupted pipeline offers Resume; one past Red tests resumes from Implement', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'running', stage: 'Review', interrupted: true, alive: false }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /^alpha\s+interrupted/)).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Resume from Implement')
  await ui.press({ key: 'resume' })
  const at = w.calls.findIndex(c => c[1] === '-c')
  expect(w.envs[at].FROM).toBe('implement')
  await ui.unmount()
})

test('a pipeline in Spec resumes from the start', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'failed', stage: 'Spec' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Resume')
  await ui.press({ key: 'resume' })
  expect(w.envs[w.calls.findIndex(c => c[1] === '-c')].FROM).toBeUndefined()
  await ui.unmount()
})

for (const [stage, from] of [['Plan', 'plan'], ['Red tests', 'red-tests']]) {
  test(`a pipeline that failed at ${stage} resumes at that stage, not at Spec`, async ($, on) => {
    const w = world(on, [{ slug: 'alpha', state: 'failed', stage }])
    const ui = await open($)
    await ui.press({ key: 'open-alpha' })
    expect((await ui.find({ key: 'resume' }))?.props.label).toBe(`Resume from ${stage}`)
    await ui.press({ key: 'resume' })
    expect(w.envs[w.calls.findIndex(c => c[1] === '-c')].FROM).toBe(from)
    await ui.unmount()
  })
}

test('a paused pipeline with nothing left to answer or decide says so and offers Resume at its stage', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Implement' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  expect(await text(ui, /Paused at Implement with nothing left to answer or decide/)).toBeDefined()
  expect(await text(ui, /questions\.md has no questions/)).toBeUndefined()
  expect((await ui.find({ key: 'resume' }))?.props.label).toBe('Resume from Implement')
  await ui.press({ key: 'resume' })
  expect(w.envs[w.calls.findIndex(c => c[1] === '-c')].FROM).toBe('implement')
  await ui.unmount()
})

test('a run whose process is gone reads as stopped, and the wrapper exit code decides failed', async ($, on) => {
  world(on, [
    { slug: 'gone', state: 'running', stage: 'Plan', alive: false },
    { slug: 'broke', exitCode: '1' },
  ])
  const ui = await open($)

  expect(await text(ui, /stopped \(process gone\) at Plan/)).toBeDefined()
  expect(await text(ui, /failed at start/)).toBeDefined()
  await ui.unmount()
})

test('a start the wrapper refused shows why, in the list and in the pipeline view', async ($, on) => {
  world(on, [{ slug: 'old', exitCode: '5', message: 'old is already merged into origin/main. Delete branch sdlc/old or set SDLC_ALLOW_MERGED=1.' }])
  const ui = await open($)

  expect(await text(ui, /failed: old is already merged into origin\/main/)).toBeDefined()
  await ui.press({ key: 'open-old' })
  expect(await text(ui, /^old is already merged/)).toBeDefined()
  await ui.unmount()
})

test('a pipeline started by hand shows its progress but offers no Stop or Resume', async ($, on) => {
  world(on, [
    { slug: 'hand', legacy: true, state: 'running', stage: 'Plan', agent: 'plan' },
    { slug: 'hand-failed', legacy: true, state: 'failed', stage: 'Implement' },
  ])
  const ui = await open($)
  await ui.press({ key: 'open-hand' })

  expect(await text(ui, /^hand\s+running/)).toBeDefined()
  expect(await text(ui, /Started outside the wrapper/)).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open-hand-failed' })
  expect(await ui.find({ key: 'resume' })).toBeUndefined()
  await ui.unmount()
})

test('Discard needs a second press; the pane then offers Start, and a started pipeline shows its record again', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'failed', stage: 'Implement' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  const discards = () => w.calls.filter(c => c[2] === 'discard')
  const launches = () => w.calls.filter(c => c[1] === '-c')

  expect((await ui.find({ key: 'discard' }))?.props.label).toBe('Discard')
  expect(await ui.find({ key: 'restart' })).toBeUndefined()
  await ui.press({ key: 'discard' })
  expect((await ui.find({ key: 'discard' }))?.props.label).toBe('Confirm discard')
  expect(await text(ui, /deletes the worktree and branch sdlc\/alpha/)).toBeDefined()
  expect(discards()).toHaveLength(0)

  await ui.press({ key: 'cancel-discard' })
  expect((await ui.find({ key: 'discard' }))?.props.label).toBe('Discard')
  expect(discards()).toHaveLength(0)

  await ui.press({ key: 'discard' })
  await ui.press({ key: 'discard' })
  expect(discards()).toEqual([['bash', 'scripts/sdlc-mod.sh', 'discard', 'alpha', '--yes', '--stop']])

  // The pipeline is gone: the pane stays on the item and offers Start (and tells how to get the branch back).
  expect(await text(ui, /^alpha\s+not started/)).toBeDefined()
  expect(await text(ui, /git branch sdlc\/alpha abc123/)).toBeDefined()
  expect((await ui.find({ key: 'start' }))?.props.label).toBe('Start')
  expect(await ui.find({ key: 'discard' })).toBeUndefined()
  expect(await ui.find({ key: 'resume' })).toBeUndefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()

  await ui.press({ key: 'start' })
  expect(launches()).toHaveLength(1)
  expect(launches()[0][2]).toContain('nohup bash "${SDLC_WRAPPER:-scripts/sdlc-mod.sh}" run "$0"')
  expect(launches()[0][launches()[0].length - 1]).toBe('alpha')
  expect(await ui.find({ key: 'start' })).toBeUndefined()
  expect(await text(ui, /Starting/)).toBeDefined()

  // Once the wrapper has written its record, the pane shows the pipeline again, with its Discard button.
  w.revive('alpha')
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  expect(await ui.find({ key: 'start' })).toBeUndefined()
  expect(await ui.find({ key: 'discard' })).toBeDefined()
  await ui.unmount()
})

test('Start comes back if the launch left no record within 20 seconds', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'failed', stage: 'Plan' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  await ui.press({ key: 'discard' })
  await ui.press({ key: 'discard' })
  await ui.press({ key: 'start' })
  expect(await ui.find({ key: 'start' })).toBeUndefined()

  await w.clock.advance(21000)
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  expect((await ui.find({ key: 'start' }))?.props.label).toBe('Start')
  await ui.unmount()
})

test('a running or starting pipeline offers both Stop and Discard', async ($, on) => {
  world(on, [
    { slug: 'going', state: 'running', stage: 'Plan', agent: 'plan' },
    { slug: 'fresh' },
  ])
  const ui = await open($)
  for (const slug of ['going', 'fresh']) {
    await ui.press({ key: `open-${slug}` })
    expect(await ui.find({ key: 'stop' })).toBeDefined()
    expect(await ui.find({ key: 'discard' })).toBeDefined()
    await ui.press({ key: 'back' })
  }
  await ui.unmount()
})

test('Discard is offered for paused, failed, interrupted and finished pipelines, not for ones started by hand', async ($, on) => {
  world(on, [
    { slug: 'waiting', state: 'paused', stage: 'Spec', questions: QUESTIONS },
    { slug: 'broke', state: 'failed', stage: 'Implement' },
    { slug: 'halted', state: 'running', stage: 'Review', interrupted: true, alive: false },
    { slug: 'finished', state: 'done', stage: 'Commit' },
    { slug: 'hand', legacy: true, state: 'failed', stage: 'Implement' },
  ])
  const ui = await open($)
  for (const slug of ['waiting', 'broke', 'halted', 'finished']) {
    await ui.press({ key: `open-${slug}` })
    expect(await ui.find({ key: 'discard' })).toBeDefined()
    await ui.press({ key: 'back' })
  }
  await ui.press({ key: 'open-hand' })
  expect(await ui.find({ key: 'discard' })).toBeUndefined()
  await ui.unmount()
})

test('the button above the prompt shows the live summary', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Plan', agent: 'plan' }, { slug: 'beta', state: 'paused', stage: 'Spec', questions: QUESTIONS }])
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  const ui = await $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: {} })

  expect((await ui.find({ key: 'sdlc-open' }))?.props.label).toBe('SDLC')
  expect(await text(ui, /1 running · 1 paused/)).toBeDefined()
  await ui.unmount()
})

test('a running pipeline shows its changed files in the overview row', async ($, on) => {
  world(on, [{ slug: 'cc-run', state: 'running', stage: 'Implement', agent: 'impl-1', attempt: '1/4', changes: { changed: 6, uncommitted: 4 } }])
  const ui = await open($)

  expect(await text(ui, /cc-run|Implement/)).toBeDefined()
  expect(await text(ui, /6 files changed \(4 uncommitted\)/)).toBeDefined()
  await ui.unmount()
})

test('a running pipeline with no changes says so; a finished one with none shows nothing', async ($, on) => {
  world(on, [
    { slug: 'cc-idle', state: 'running', stage: 'Spec', agent: 'spec-1', changes: { changed: 0, uncommitted: 0 } },
    { slug: 'cc-done0', state: 'done', stage: 'Commit', changes: { changed: 0, uncommitted: 0 } },
  ])
  const ui = await open($)

  expect(await text(ui, /no changes yet/)).toBeDefined()
  expect(await text(ui, /^done$/)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /files? changed/ })).toBeUndefined()
  await ui.unmount()
})

test('an unmanaged run makes no changes call and a failing call shows no counts and no Files line', async ($, on) => {
  const w = world(on, [
    { slug: 'cc-hand', state: 'running', stage: 'Plan', agent: 'plan', legacy: true },
    { slug: 'cc-gone', state: 'failed', stage: 'Plan', changes: null },
  ])
  const ui = await open($)

  expect(changesCalls(w.calls, 'cc-hand')).toEqual([])
  expect(changesCalls(w.calls, 'cc-gone').length).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /files? changed/ })).toBeUndefined()
  await ui.press({ key: 'open-cc-gone' })
  expect(await ui.find({ type: 'Text', text: /^Files /i })).toBeUndefined()
  await ui.unmount()
})

test('the pipeline view shows the Files line with the base, or the word base, and for 0/0', async ($, on) => {
  world(on, [
    { slug: 'cc-based', state: 'running', stage: 'Implement', agent: 'impl-1', base: 'origin/develop', changes: { changed: 7, uncommitted: 3 } },
    { slug: 'cc-nobase', state: 'done', stage: 'Commit', changes: { changed: 0, uncommitted: 0 } },
  ])
  const ui = await open($)
  await ui.press({ key: 'open-cc-based' })
  expect(await text(ui, /^Files /)).toBe('Files  7 changed since origin/develop · 3 uncommitted')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'open-cc-nobase' })
  expect(await text(ui, /^Files /)).toBe('Files  0 changed since base · 0 uncommitted')
  await ui.unmount()
})

test('every due pipeline is counted in one call; an unchanged one is recounted only when running (every 15 s) or on Refresh', async ($, on) => {
  const w = world(on, [
    { slug: 'cc-fin', state: 'done', stage: 'Commit', changes: { changed: 2, uncommitted: 0 } },
    { slug: 'cc-live', state: 'running', stage: 'Implement', agent: 'impl-1', changes: { changed: 1, uncommitted: 1 } },
  ])
  const ui = await open($)
  // the first refresh counts both in one call
  const both = w.calls.filter(c => c[2] === 'changes')
  expect(both).toHaveLength(1)
  expect(both[0].slice(3)).toEqual(['--all', 'cc-live', 'cc-fin'])
  const fin0 = changesCalls(w.calls, 'cc-fin').length
  const live0 = changesCalls(w.calls, 'cc-live').length

  // nothing changed and under 15 s: neither is recounted
  await w.clock.advance(2000)
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  expect(changesCalls(w.calls, 'cc-fin').length).toBe(fin0)
  expect(changesCalls(w.calls, 'cc-live').length).toBe(live0)

  // 15 s later the running one is recounted, the finished one is not
  await w.clock.advance(15000)
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  expect(changesCalls(w.calls, 'cc-live').length).toBeGreaterThan(live0)
  expect(changesCalls(w.calls, 'cc-fin').length).toBe(fin0)

  // Refresh recounts every pipeline, and its label is back once it is done
  await ui.press({ key: 'refresh' })
  expect(changesCalls(w.calls, 'cc-fin').length).toBeGreaterThan(fin0)
  expect(String((await ui.find({ key: 'refresh' }))?.props.label)).toBe('Refresh')
  await ui.unmount()
})

test('Refresh shows a spinner while it works and ignores a second press meanwhile', async ($, on) => {
  const w = world(on, [{ slug: 'cc-fin', state: 'done', stage: 'Commit', changes: { changed: 2, uncommitted: 0 } }])
  const ui = await open($)
  const before = changesCalls(w.calls, 'cc-fin').length

  // hold the count open so the press is still working while the pane is looked at
  let release: () => void = () => {}
  countGate.wait = new Promise<void>(r => (release = r))
  const first = ui.press({ key: 'refresh' })
  await new Promise(r => setTimeout(r, 20))
  expect(String((await ui.find({ key: 'refresh' }))?.props.label)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Refreshing/)
  await ui.press({ key: 'refresh' })
  release()
  await first
  countGate.wait = Promise.resolve()

  expect(changesCalls(w.calls, 'cc-fin').length).toBe(before + 1)
  expect(String((await ui.find({ key: 'refresh' }))?.props.label)).toBe('Refresh')
  await ui.unmount()
})

test('Refresh spins and takes no press while any refresh runs, not only its own', async ($, on) => {
  const w = world(on, [{ slug: 'cc-fin', state: 'done', stage: 'Commit', changes: { changed: 2, uncommitted: 0 } }])
  const ui = await $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'Pane', requestId: 'sdlc', props: {} })

  // a refresh the button did not start (the command's), held open in its count
  let release: () => void = () => {}
  countGate.wait = new Promise<void>(r => (release = r))
  const opening = $.command.run({ command: 'sdlc-monitor', args: '' })
  await new Promise(r => setTimeout(r, 20))
  expect(String((await ui.find({ key: 'refresh' }))?.props.label)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Refreshing/)
  await ui.press({ key: 'refresh' })
  release()
  await opening
  countGate.wait = Promise.resolve()

  // the press was ignored: only the command's refresh counted
  expect(changesCalls(w.calls, 'cc-fin')).toHaveLength(1)
  expect(String((await ui.find({ key: 'refresh' }))?.props.label)).toBe('Refresh')
  await ui.unmount()
})

// ---- CONFIG pane ----

const modelCalls = (calls: string[][]) => calls.filter(c => c[0] === 'bash' && c[1] === 'scripts/sdlc-mod.sh' && c[2] === 'model').map(c => c.slice(3))

async function openConfig($: any) {
  await $.command.run({ command: 'sdlc-config', args: '' })

  return $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'Pane', requestId: 'config', props: {} })
}

type Reg = Record<string, { endpoint: string; api_key_env: string; models: string[]; effort: boolean; key_set: boolean }>

const REGISTRY: Reg = {
  acme: { endpoint: 'https://a.example', api_key_env: 'ACME_KEY', models: ['fast', 'big'], effort: true, key_set: true },
  other: { endpoint: 'http://localhost:4000', api_key_env: 'OTHER_KEY', models: ['one'], effort: false, key_set: false },
}

// A registry in memory that answers like scripts/sdlc-models.cjs; `fail` overrides one subcommand.
function registry(start: Reg, fail: Record<string, ModelReply> = {}) {
  const reg: Reg = JSON.parse(JSON.stringify(start))

  return (argv: string[]): ModelReply => {
    const [cmd] = argv
    if (fail[cmd]) return fail[cmd]
    if (cmd === 'list') return { stdout: JSON.stringify({ providers: reg }) + '\n' }
    if (cmd === 'add') return { stdout: `added ${argv[1]} (${argv[argv.indexOf('--models') + 1].split(',').length} models)\n` }
    if (cmd === 'remove') return { stdout: `removed ${argv[1]}\n` }
    if (cmd === 'remove-model') return { stdout: `removed ${argv[1]}/${argv[2]}\n` }
    if (cmd === 'test') return { stdout: 'ok\n' }

    return undefined
  }
}

const type = async (ui: any, key: string, value: string) => {
  await ui.input({ key, text: value })
}

test('CONFIG button sits beside SDLC and opens the CONFIG pane', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  const ui = await $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: {} })

  expect((await ui.find({ key: 'sdlc-open' }))?.props.label).toBe('SDLC')
  const button = await ui.find({ key: 'config-open' })
  expect(button?.props.label).toBe('CONFIG')
  expect(button?.props.variant).toBeUndefined()
  await ui.press({ key: 'config-open' })
  expect(w.opens).toContainEqual({ id: 'config', title: 'CONFIG' })
  await ui.unmount()
})

test('/sdlc-config opens the pane and the registry is not read before that', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  await $.command.run({ command: 'sdlc-monitor', args: '' })
  expect(modelCalls(w.calls)).toEqual([])
  const r = (await $.command.run({ command: 'sdlc-config', args: '' })) as { text: string }

  expect(r.text.length).toBeGreaterThan(0)
  expect(w.opens).toContainEqual({ id: 'config', title: 'CONFIG' })
  expect(modelCalls(w.calls)).toEqual([['list', '--json']])
})

test('the pane lists providers, key state, models and effort', async ($, on) => {
  world(on, [], registry(REGISTRY))
  const ui = await openConfig($)

  for (const re of [/^acme$/, /https:\/\/a\.example/, /^ACME_KEY$/, /^key set$/, /^other$/, /^OTHER_KEY$/, /^key NOT set$/, /^fast$/, /^big$/, /^one$/]) {
    expect(await text(ui, re)).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: /^effort$/ })).toBeDefined()
  await ui.unmount()
})

test('an empty registry shows the note and an Add provider button, not the form', async ($, on) => {
  world(on, [], registry({}))
  const ui = await openConfig($)

  expect(await text(ui, /No custom providers/)).toBeDefined()
  expect(await ui.find({ key: 'config-add-new' })).toBeDefined()
  expect(await ui.find({ key: 'config-in-provider' })).toBeUndefined()
  await ui.unmount()
})

test('a failing list shows its line, keeps Add provider and gives no toast', async ($, on) => {
  const w = world(on, [], registry(REGISTRY, { list: { exitCode: 1, stderr: '/x/models.json: not valid JSON\n' } }))
  const ui = await openConfig($)

  expect(await text(ui, /models\.json: not valid JSON/)).toBeDefined()
  expect(await ui.find({ key: 'config-add-new' })).toBeDefined()
  expect(w.toasts).toEqual([])
  await ui.unmount()
})

test('every open reads the registry again, only through the wrapper', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const first = await openConfig($)
  await first.unmount()
  const second = await openConfig($)
  await second.unmount()

  expect(modelCalls(w.calls).filter(c => c[0] === 'list').length).toBe(2)
  expect(w.calls.filter(c => c.join(' ').includes('models.json') || c.join(' ').includes('sdlc-models.cjs'))).toEqual([])
})

const fill = async (ui: any, v: { provider?: string; endpoint?: string; keyEnv?: string; models?: string }) => {
  if (v.provider !== undefined) await type(ui, 'config-in-provider', v.provider)
  if (v.endpoint !== undefined) await type(ui, 'config-in-endpoint', v.endpoint)
  if (v.keyEnv !== undefined) await type(ui, 'config-in-keyEnv', v.keyEnv)
  if (v.models !== undefined) await type(ui, 'config-in-models', v.models)
}

test('Add provider opens the form; Save adds the provider and returns to the list', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  expect(await ui.find({ key: 'config-add-new' })).toBeUndefined()
  await fill(ui, { provider: 'beta', endpoint: 'https://c.example', keyEnv: 'BETA_KEY', models: 'm1,m2' })
  expect(modelCalls(w.calls).some(c => c[0] === 'add')).toBe(false)
  await ui.press({ key: 'config-save' })

  expect(modelCalls(w.calls).find(c => c[0] === 'add')).toEqual(['add', 'beta', '--endpoint', 'https://c.example', '--key-env', 'BETA_KEY', '--models', 'm1,m2'])
  expect(w.toasts).toContain('added beta (2 models)')
  expect(await ui.find({ key: 'config-add-new' })).toBeDefined()
  expect(await ui.find({ key: 'config-in-provider' })).toBeUndefined()
  await ui.unmount()
})

test('a mixed-case provider name is saved in lowercase', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  await fill(ui, { provider: ' OpenRouter ', endpoint: 'https://openrouter.ai/api', keyEnv: 'OPENROUTER_KEY', models: 'm1' })
  await ui.press({ key: 'config-save' })

  expect(modelCalls(w.calls).find(c => c[0] === 'add')?.[1]).toBe('openrouter')
  await ui.unmount()
})

test('Save and add another keeps the form open and empty', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  await fill(ui, { provider: 'beta', endpoint: 'https://c.example', keyEnv: 'BETA_KEY', models: 'm1' })
  await ui.press({ key: 'config-save-another' })

  expect(modelCalls(w.calls).filter(c => c[0] === 'add').length).toBe(1)
  expect(await ui.find({ key: 'config-in-provider' })).toBeDefined()
  expect((await ui.find({ key: 'config-in-provider' }))?.props.value).toBe('')
  await ui.unmount()
})

test('a new provider whose name exists is refused and nothing is saved', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  await fill(ui, { provider: 'acme', endpoint: 'https://x.example', keyEnv: 'K', models: 'm' })
  await ui.press({ key: 'config-save' })

  expect(modelCalls(w.calls).some(c => c[0] === 'add')).toBe(false)
  expect(w.toasts).toContain('acme already exists: press Edit on it')
  expect(await ui.find({ key: 'config-in-provider' })).toBeDefined()
  await ui.unmount()
})

test('Edit opens the form filled with the stored values and Save replaces them', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-edit:acme' })
  expect(await ui.find({ key: 'config-in-provider' })).toBeUndefined()
  expect((await ui.find({ key: 'config-in-endpoint' }))?.props.value).toBe('https://a.example')
  expect((await ui.find({ key: 'config-in-keyEnv' }))?.props.value).toBe('ACME_KEY')
  expect((await ui.find({ key: 'config-in-models' }))?.props.value).toBe('fast,big')
  expect((await ui.find({ key: 'config-effort' }))?.props.label).toBe('Effort flag: on')
  expect(await ui.find({ key: 'config-save-another' })).toBeUndefined()
  await type(ui, 'config-in-models', 'fast,big,huge')
  await ui.press({ key: 'config-save' })

  expect(modelCalls(w.calls).find(c => c[0] === 'add')).toEqual(['add', 'acme', '--endpoint', 'https://a.example', '--key-env', 'ACME_KEY', '--models', 'fast,big,huge', '--effort'])
  expect(await ui.find({ key: 'config-add-new' })).toBeDefined()
  await ui.unmount()
})

test('the effort flag toggles and is passed on Save', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-edit:other' })
  expect((await ui.find({ key: 'config-effort' }))?.props.label).toBe('Effort flag: off')
  await ui.press({ key: 'config-effort' })
  expect((await ui.find({ key: 'config-effort' }))?.props.label).toBe('Effort flag: on')
  await ui.press({ key: 'config-save' })

  expect(modelCalls(w.calls).find(c => c[0] === 'add')?.slice(-1)).toEqual(['--effort'])
  await ui.unmount()
})

test('Cancel returns to the list without saving', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  await fill(ui, { provider: 'beta' })
  await ui.press({ key: 'config-cancel' })

  expect(modelCalls(w.calls).some(c => c[0] === 'add')).toBe(false)
  expect(await ui.find({ key: 'config-add-new' })).toBeDefined()
  await ui.press({ key: 'config-add-new' })
  expect((await ui.find({ key: 'config-in-provider' }))?.props.value).toBe('')
  await ui.unmount()
})

test('a rejected save shows the line and stays on the form with the typed values', async ($, on) => {
  const w = world(on, [], registry(REGISTRY, { add: { exitCode: 1, stderr: 'endpoint must be https\n' } }))
  const ui = await openConfig($)
  await ui.press({ key: 'config-add-new' })
  await fill(ui, { provider: 'beta', endpoint: 'http://c.example', keyEnv: 'BETA_KEY', models: 'm1' })
  await ui.press({ key: 'config-save' })

  expect(w.toasts).toContain('endpoint must be https')
  expect((await ui.find({ key: 'config-in-endpoint' }))?.props.value).toBe('http://c.example')
  expect((await ui.find({ key: 'config-in-provider' }))?.props.value).toBe('beta')
  await ui.unmount()
})

test('Test reports ok', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-test:acme/fast' })
  expect(modelCalls(w.calls).find(c => c[0] === 'test')).toEqual(['test', 'acme/fast'])
  expect(w.toasts).toContain('acme/fast: ok')
  await ui.unmount()
})

test('a failed Test shows the failing line from stdout', async ($, on) => {
  const w = world(on, [], registry(REGISTRY, { test: { exitCode: 1, stdout: 'HTTP 401: bad key\n' } }))
  const ui = await openConfig($)
  await ui.press({ key: 'config-test:other/one' })
  expect(w.toasts).toContain('other/one: HTTP 401: bad key')
  await ui.unmount()
})

test('provider Remove needs a second press and Keep it cancels', async ($, on) => {
  const w = world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-remove-provider:acme' })
  expect(modelCalls(w.calls).some(c => c[0] === 'remove')).toBe(false)
  expect((await ui.find({ key: 'config-remove-provider:acme' }))?.props.label).toBe('Confirm remove')
  expect((await ui.find({ key: 'config-remove-provider:other' }))?.props.label).toBe('Remove')
  await ui.press({ key: 'config-keep-provider' })
  expect((await ui.find({ key: 'config-remove-provider:acme' }))?.props.label).toBe('Remove')
  await ui.press({ key: 'config-remove-provider:acme' })
  await ui.press({ key: 'config-remove-provider:acme' })

  expect(modelCalls(w.calls).find(c => c[0] === 'remove')).toEqual(['remove', 'acme'])
  expect(w.toasts).toContain('removed acme')
  await ui.unmount()
})

test('model Remove needs a second press and shows a refusal as a toast', async ($, on) => {
  const w = world(on, [], registry(REGISTRY, { 'remove-model': { exitCode: 1, stderr: 'cannot remove the last model\n' } }))
  const ui = await openConfig($)
  await ui.press({ key: 'config-remove-model:other/one' })
  expect((await ui.find({ key: 'config-remove-model:other/one' }))?.props.label).toBe('Confirm remove')
  await ui.press({ key: 'config-remove-model:other/one' })

  expect(modelCalls(w.calls).find(c => c[0] === 'remove-model')).toEqual(['remove-model', 'other', 'one'])
  expect(w.toasts).toContain('cannot remove the last model')
  await ui.unmount()
})

test('pending confirmations are cleared when the pane is opened again', async ($, on) => {
  world(on, [], registry(REGISTRY))
  const ui = await openConfig($)
  await ui.press({ key: 'config-remove-provider:acme' })
  await ui.press({ key: 'config-remove-model:acme/fast' })
  await ui.unmount()
  const again = await openConfig($)

  expect((await again.find({ key: 'config-remove-provider:acme' }))?.props.label).toBe('Remove')
  expect((await again.find({ key: 'config-remove-model:acme/fast' }))?.props.label).toBe('Remove')
  await again.unmount()
})

test('a failure without a message falls back to the exit code', async ($, on) => {
  const w = world(on, [], registry(REGISTRY, { test: { exitCode: 3 } }))
  const ui = await openConfig($)
  await ui.press({ key: 'config-test:acme/fast' })

  expect(w.toasts).toContain('acme/fast: failed (exit 3)')
  await ui.unmount()
})

test('a refused Resume shows the wrapper error in the notice, and Copy puts it on the clipboard', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'failed', stage: 'Plan', launchError: 'cap reached: 2 pipelines are running' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  await ui.press({ key: 'resume' })

  expect(await text(ui, /alpha did not start: .*cap reached/s)).toBeDefined()
  expect(w.toasts.some(t => /did not start/.test(t))).toBe(true)
  await ui.press({ key: 'notice-copy' })
  expect(w.copies).toHaveLength(1)
  expect(w.copies[0]).toMatch(/cap reached/)
  await ui.press({ key: 'notice-dismiss' })
  expect(await ui.find({ key: 'notice-copy' })).toBeUndefined()
  await ui.unmount()
})

test('a failed stage shows the end of its own log as the reason, with Copy', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'failed', stage: 'Plan', files: ['plan.log'], planLog: 'reading specs\nPermission denied: edit of .claude/plugins\nplan agent exited 1\n' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /Why it failed \(Plan\)/)).toBeDefined()
  expect(await text(ui, /Permission denied: edit of \.claude\/plugins/)).toBeDefined()
  await ui.press({ key: 'reason-copy' })
  expect(w.copies[0]).toContain('plan agent exited 1')
  await ui.unmount()
})

test('the Test button shows what it is waiting for until the answer comes', async ($, on) => {
  let release: (v: ModelReply) => void = () => {}
  const w = world(on, [], argv => (argv[0] === 'test' ? new Promise<ModelReply>(r => (release = r)) : registry(REGISTRY)(argv)))
  const ui = await openConfig($)
  const pressing = ui.press({ key: 'config-test:acme/fast' })
  await new Promise(r => setTimeout(r, 20))
  expect(await text(ui, /Testing acme\/fast/)).toBeDefined()
  release({ stdout: 'ok' })
  await pressing
  expect(await text(ui, /Testing acme\/fast/)).toBeUndefined()
  expect(w.toasts.some(t => /acme\/fast/.test(t))).toBe(true)
  await ui.unmount()
})

const ASKS = [
  { stage: 'implement', tool: 'Bash', detail: 'git push origin main', rule: 'Bash(git push:*)', protected: false },
  { stage: 'implement', tool: 'Edit', detail: '.claude/plugins/p/f.tsx', rule: 'Edit(./.claude/plugins/p/f.tsx)', protected: true },
]

test('a pipeline waiting for the usage limit says so, with the reset time, in its state line', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Implement', agent: 'impl-1', attempt: '1/4', note: 'usage limit, resets 1:10am (Asia/Dubai)' }])
  const ui = await open($)
  expect(await text(ui, /Implement · waiting: usage limit, resets 1:10am \(Asia\/Dubai\)/)).toBeDefined()
  await ui.unmount()
})

test('a paused run is described by what it waits for: refused actions, or nothing', async ($, on) => {
  world(on, [
    { slug: 'asks', state: 'paused', stage: 'Implement', permissions: ASKS },
    { slug: 'idle', state: 'paused', stage: 'Implement' },
  ])
  const ui = await open($)
  expect(await text(ui, /needs a decision: 2 refused actions/)).toBeDefined()
  expect(await text(ui, /paused at Implement/)).toBeDefined()
  expect(await text(ui, /needs answers: 0 questions/)).toBeUndefined()
  await ui.unmount()
})

test('a paused run lists what the agent was refused; Allow always is offered only for a path that a rule can open', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'paused', stage: 'Implement', permissions: ASKS }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /agent was refused 2 action/)).toBeDefined()
  expect(await text(ui, /Bash: git push origin main/)).toBeDefined()
  expect(await text(ui, /Protected path: allowing it runs the whole implement stage with permission checks off/)).toBeDefined()
  expect(await ui.find({ key: 'perm-always:0' })).toBeDefined()
  expect(await ui.find({ key: 'perm-always:1' })).toBeUndefined()
  expect(await text(ui, /questions.md has no questions/)).toBeUndefined()
  await ui.unmount()
})

test('Allow sends the decision to the wrapper; the run resumes at the refused stage once none is left', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Implement', permissions: ASKS }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  const permits = () => w.calls.filter(c => c[2] === 'permit')
  const launches = () => w.calls.filter(c => c[1] === '-c')

  await ui.press({ key: 'perm-allow:0' })
  expect(permits()[0]).toEqual(['bash', 'scripts/sdlc-mod.sh', 'permit', 'alpha', 'allow', '0'])
  expect(w.toasts).toContain('Allowed: 1 more to decide')
  expect(launches()).toHaveLength(0)

  await ui.press({ key: 'perm-allow:0' })
  expect(launches()).toHaveLength(1)
  expect(w.envs[w.calls.indexOf(launches()[0])].FROM).toBe('implement')
  await ui.unmount()
})

test('Deny all and Allow always use the wrapper choices deny and always', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Spec', permissions: [{ ...ASKS[0], stage: 'spec' }, { ...ASKS[0], stage: 'spec', detail: 'curl x' }] }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  await ui.press({ key: 'perm-always:0' })
  expect(w.calls.find(c => c[2] === 'permit')?.slice(4)).toEqual(['always', '0'])
  await ui.press({ key: 'perm-deny-all' })
  expect(w.calls.filter(c => c[2] === 'permit')[1].slice(4)).toEqual(['deny', 'all'])
  // spec restarts from the beginning: no FROM
  expect(w.envs[w.calls.findIndex(c => c[1] === '-c')].FROM).toBeUndefined()
  await ui.unmount()
})

test('the run view lists the files each stage changed, with a count and "+N more" past the first eight', async ($, on) => {
  const many = Array.from({ length: 10 }, (_, i) => `server/f${i}.js`)
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Implement', stageFiles: { Spec: ['Docs/backlog/alpha/specs-1.md'], Implement: many } }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /Files changed per stage/)).toBeDefined()
  expect(await text(ui, /Spec \(1\)/)).toBeDefined()
  expect(await text(ui, /Docs\/backlog\/alpha\/specs-1\.md/)).toBeDefined()
  expect(await text(ui, /Implement \(10\)/)).toBeDefined()
  expect(await text(ui, /server\/f7\.js/)).toBeDefined()
  expect(await text(ui, /server\/f8\.js/)).toBeUndefined()
  expect(await text(ui, /\+2 more/)).toBeDefined()
  await ui.unmount()
})

test('a run with no stage-files.json shows no files section', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Plan' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /Files changed per stage/)).toBeUndefined()
  await ui.unmount()
})

test('Stop and Discard show what they are doing until the wrapper returns', async ($, on) => {
  let release: () => void = () => {}
  const w = world(on, [{ slug: 'alpha', state: 'running', stage: 'Plan' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })

  await ui.press({ key: 'stop' })
  gate.wait = new Promise<void>(r => (release = r))
  const pressing = ui.press({ key: 'stop' })
  await new Promise(r => setTimeout(r, 20))
  expect(await text(ui, /Stopping alpha/)).toBeDefined()
  // the button itself spins, offers no second choice, and nothing is announced until the stop is complete
  expect(String((await ui.find({ key: 'stop' }))?.props.label)).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Stopping/)
  expect(await ui.find({ key: 'cancel-stop' })).toBeUndefined()
  expect(w.toasts).not.toContain('Stopped alpha.')
  release()
  await pressing
  gate.wait = Promise.resolve()
  expect(await text(ui, /Stopping alpha/)).toBeUndefined()
  expect(w.toasts).toContain('Stopped alpha.')
  expect(w.calls.some(c => c[2] === 'stop' && c[3] === 'alpha')).toBe(true)

  await ui.press({ key: 'discard' })
  gate.wait = new Promise<void>(r => (release = r))
  const discarding = ui.press({ key: 'discard' })
  await new Promise(r => setTimeout(r, 20))
  expect(await text(ui, /Discarding alpha \(stopping it/)).toBeDefined()
  release()
  await discarding
  gate.wait = Promise.resolve()
  expect(w.toasts).toContain('Discarded alpha.')
  await ui.unmount()
})

test('a failed Stop says why instead of reporting success', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'running', stage: 'Plan', stopError: 'could not kill pid 100' }])
  const ui = await open($)
  await ui.press({ key: 'open-alpha' })
  await ui.press({ key: 'stop' })
  await ui.press({ key: 'stop' })

  expect(w.toasts).toContain('Could not stop alpha: could not kill pid 100')
  expect(w.toasts).not.toContain('Stopped alpha.')
  await ui.unmount()
})

async function openAt($: any, bodyColumns: number) {
  await $.command.run({ command: 'sdlc-monitor', args: '' })

  return $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'Pane', requestId: 'sdlc', props: { bodyColumns } })
}

test('board: a wide pane shows every column; pending items sit in Backlog and runs in their stage column', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Implement', agent: 'impl-1', attempt: '1/4' }])
  const ui = await openAt($, 200)

  expect(await text(ui, /columns 1-7 of 7/)).toBeDefined()
  expect(await ui.find({ key: 'sel-one' })).toBeDefined()
  expect(await ui.find({ key: 'open-alpha' })).toBeDefined()
  await ui.unmount()
})

test('board: a narrow pane windows the columns and the arrows move the window', async ($, on) => {
  world(on)
  const ui = await openAt($, 60)

  expect(await text(ui, /columns 1-2 of 7/)).toBeDefined()
  await ui.press({ key: 'board-right' })
  expect(await text(ui, /columns 2-3 of 7/)).toBeDefined()
  await ui.press({ key: 'board-left' })
  expect(await text(ui, /columns 1-2 of 7/)).toBeDefined()
  await ui.unmount()
})

test('board: opening a pipeline keeps the board at a quarter, scrolled to the pipeline column, with Close to go back', async ($, on) => {
  world(on, [{ slug: 'alpha', state: 'running', stage: 'Implement', agent: 'impl-1', attempt: '1/4' }])
  const ui = await openAt($, 200)
  await ui.press({ key: 'open-alpha' })

  expect(await text(ui, /columns \d-\d of 7/)).toMatch(/columns 4-5 of 7/) // 50 cells fit two columns, moved to show Implement
  expect(await ui.find({ key: 'open-alpha' })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await text(ui, /columns 1-7 of 7/)).toBeDefined()
  await ui.unmount()
})

test('backlog: Open on a pending card shows its brief read-only, a missing brief says so, Close goes back', async ($, on) => {
  world(on)
  const ui = await openAt($, 200)

  await ui.press({ key: 'more-one' })
  expect(await text(ui, /Ticket \(brief.md\)/)).toBeDefined()
  expect(await text(ui, /^# one/)).toBeDefined()
  expect(await text(ui, /Fix the first thing in detail/)).toBeDefined()
  await ui.press({ key: 'more-two' })
  expect(await text(ui, /No brief.md found/)).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await text(ui, /columns 1-7 of 7/)).toBeDefined()
  await ui.unmount()
})

test('every repo path hangs on the main working tree, so a session inside a pipeline worktree or a subfolder still works', async ($, on) => {
  repoTop.value = '/repo'
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Plan', permissions: [{ stage: 'Plan', tool: 'Bash', detail: 'npm prefix -g', rule: 'Bash(npm prefix:*)', protected: false }] }])
  const ui = await openAt($, 200)
  await ui.press({ key: 'open-alpha' })
  await ui.press({ key: 'perm-allow:0' })

  expect(w.calls.some(c => c[0] === 'bash' && c[1] === '/repo/scripts/sdlc-mod.sh' && c[2] === 'permit')).toBe(true)
  expect(w.envs.some(env => env.SDLC_WRAPPER === '/repo/scripts/sdlc-mod.sh')).toBe(true)
  expect(w.calls.some(c => c[0] === 'node' && c[1] === '/repo/scripts/backlog-list.cjs')).toBe(true)
  repoTop.value = ''
  await ui.unmount()
})

test('a running pipeline spins on its board card and on its active stage box; a paused one does not', async ($, on) => {
  world(on, [
    { slug: 'alpha', state: 'running', stage: 'Plan', agent: 'plan-agent', attempt: '' },
    { slug: 'beta', state: 'paused', stage: 'Plan', questions: QUESTIONS },
  ])
  const ui = await openAt($, 200)
  const spin = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

  expect((await ui.find({ key: 'open-alpha' }))?.props.label).toMatch(spin)
  expect((await ui.find({ key: 'open-beta' }))?.props.label).toMatch(/^⏸/)
  await ui.press({ key: 'open-alpha' })
  expect(await text(ui, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Plan/)).toBeDefined()
  await ui.unmount()
})

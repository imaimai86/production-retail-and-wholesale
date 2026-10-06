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
  // a pipeline started by hand: no wrapper record, only a status.json in the main working tree
  legacy?: boolean
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
function world(on: any, runs: RunSpec[] = []) {
  const calls: string[][] = []
  const envs: Record<string, string>[] = []
  const writes: { path: string; text: string }[] = []
  const file = (name: string) => ({ name, kind: 'file', size: 1 })
  const pidOf = (r: RunSpec) => (r.alive === false ? 999 : 100)
  // slugs whose run record the wrapper has deleted (discard); revive() brings one back, as a new start would
  const gone = new Set<string>()

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
    for (const g of gone) if (e.path.endsWith(`sdlc-runs/${g}.discarded`)) return { value: `git branch sdlc/${g} abc123\n` }
    for (const r of runs) {
      if (gone.has(r.slug)) continue
      if (e.path.endsWith(`sdlc-runs/${r.slug}.json`)) {
        return {
          value: JSON.stringify({
            slug: r.slug, worktree: WT, pid: pidOf(r), started: '2026-10-06T10:00:00',
            state: r.exitCode ? 'exited' : 'running', exit_code: r.exitCode ?? '', interrupted: r.interrupted === true, message: r.message ?? '',
          }),
        }
      }
      if (e.path.endsWith(`${r.slug}/logs/status.json`) && r.state) {
        return {
          value: JSON.stringify({
            slug: r.slug, state: r.state, stage: r.stage ?? '', agent: r.agent ?? '', attempt: r.attempt ?? '',
            agent_started: '2026-10-06T10:00:00', run_started: '2026-10-06T09:50:00', updated: '2026-10-06T10:03:00', pid: pidOf(r),
          }),
        }
      }
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
  on('process.run', (_: unknown, e: { argv: string[]; init?: { env?: Record<string, string> } }) => {
    calls.push([...e.argv])
    if (e.argv[2] === 'discard') gone.add(e.argv[3])
    envs.push(e.init?.env ?? {})
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false } })
    if (e.argv[0] === 'git') return out('.git\n')
    if (e.argv[0] === 'node') return out(JSON.stringify(PENDING))
    if (e.argv[0] === 'kill') return out('', e.argv[2] === '100' ? 0 : 1)

    return out('')
  })
  on('agent.list', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)

  return { calls, envs, writes, clock, revive: (slug: string) => gone.delete(slug) }
}

async function open($: any) {
  await $.command.run({ command: 'sdlc-monitor', args: '' })

  return $.ui.mount({ plugin: 'sdlc-monitor', surface: 'terminal', component: 'Pane', requestId: 'sdlc', props: {} })
}

const launches = (calls: string[][]) => calls.filter(c => c[0] === 'bash' && c[1] === '-c').map(c => c[c.length - 1])
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
  expect(cmd[2]).toContain('nohup bash scripts/sdlc-mod.sh run "$0"')
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
  expect(await text(ui, /impl-2/)).toMatch(/03:12/)
  expect(await text(ui, /attempt/)).toMatch(/2\/4/)
  expect(await text(ui, /Tests/)).toMatch(/15\/20 passing/)
  expect(await text(ui, /impl ×2/)).toBeDefined()
  expect(await text(ui, /agent: impl-2/)).toBeDefined()
  await ui.unmount()
})

test('a paused pipeline shows its questions; answers are written and the pipeline resumes', async ($, on) => {
  const w = world(on, [{ slug: 'alpha', state: 'paused', stage: 'Spec', questions: QUESTIONS }])
  const ui = await open($)
  expect(await text(ui, /^⏸ alpha/)).toBeDefined()
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
  expect(launches()[0][2]).toContain('nohup bash scripts/sdlc-mod.sh run "$0"')
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

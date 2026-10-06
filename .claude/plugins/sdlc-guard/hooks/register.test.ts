import { test, expect } from 'claude-code/testing'

type Stage = 'Spec' | 'Plan' | 'Red tests' | 'Implement' | 'Review' | null

// A repo whose pipeline is running `stage` for slug `demo`, with `have` already written.
function repo($: any, on: any, stage: Stage, have: string[] = []) {
  on('fs.list', () => ({ value: stage ? [{ name: 'demo', kind: 'dir', size: 0 }] : [] }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (stage && e.path.endsWith('status.json')) {
      return { value: JSON.stringify({ slug: 'demo', state: 'running', stage, pid: 1, updated: '2026-10-06T10:00:00' }) }
    }

    return { deny: 'ENOENT' }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: have.some(f => e.path.endsWith(f)) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('tool.call', () => ({ result: 'ran', text: 'ran' }))
}

const write = ($: any, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: 'x' })

test('Implement and Review lock the tests', async ($, on) => {
  repo($, on, 'Implement')
  expect((await write($, 'server/__tests__/a.test.js')).deny).toMatch(/read-only/)
  expect((await write($, 'server/routes/a.js')).deny).toBeUndefined()
})

test('Red tests may write tests but never source', async ($, on) => {
  repo($, on, 'Red tests')
  expect((await write($, 'server/__tests__/a.test.js')).deny).toBeUndefined()
  expect((await write($, 'server/routes/a.js')).deny).toMatch(/never source/)
})

test('Spec writes only its own backlog folder', async ($, on) => {
  repo($, on, 'Spec')
  expect((await write($, 'Docs/backlog/demo/specs-1.md')).deny).toBeUndefined()
  expect((await write($, 'server/routes/a.js')).deny).toMatch(/only Docs/)
  expect((await write($, 'Docs/backlog/other/specs-1.md')).deny).toMatch(/only Docs/)
})

test('stages run in order: plan needs a spec', async ($, on) => {
  repo($, on, 'Plan')
  expect((await write($, 'Docs/backlog/demo/plan-1.md')).deny).toMatch(/needs specs-1.md/)
})

test('plan is allowed once the spec exists', async ($, on) => {
  repo($, on, 'Plan', ['specs-1.md'])
  expect((await write($, 'Docs/backlog/demo/plan-1.md')).deny).toBeUndefined()
})

test('no running pipeline means no restriction', async ($, on) => {
  repo($, on, null)
  expect((await write($, 'server/__tests__/a.test.js')).deny).toBeUndefined()
})

test('Bash cannot rewrite tests while implementing', async ($, on) => {
  repo($, on, 'Implement')
  const r = await $.tool.call({ tool: 'Bash', command: 'sed -i "s/a/b/" server/__tests__/a.test.js' })
  expect(r.deny).toMatch(/read-only/)
  expect((await $.tool.call({ tool: 'Bash', command: 'npm test' })).deny).toBeUndefined()
})

test('a check that crashes refuses the call (fails closed)', async ($, on) => {
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '{"phase":"implement","slug":"demo"}' }))
  on('fs.exists', () => ({ deny: 'boom' }))
  on('tool.call', () => ({ result: 'ran', text: 'ran' }))
  // the sdlc-state.json fallback says Implement; a Write under Docs/ then needs a prerequisite check that throws
  const r = await write($, 'Docs/backlog/demo/plan-1.md')
  expect(r.deny).toMatch(/sdlc-guard/)
})

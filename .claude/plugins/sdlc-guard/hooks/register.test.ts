import { test, expect } from 'claude-code/testing'

type Stage = 'Spec' | 'Plan' | 'Red tests' | 'Implement' | 'Review' | null

// A repo whose pipeline is running `stage` for slug `demo`, with `have` already written.
function repo($: any, on: any, stage: Stage, have: string[] = [], layout = '') {
  on('fs.list', () => ({ value: stage ? [{ name: 'demo', kind: 'dir', size: 0 }] : [] }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (stage && e.path.endsWith('status.json')) {
      return { value: JSON.stringify({ slug: 'demo', state: 'running', stage, pid: 1, updated: '2026-10-06T10:00:00' }) }
    }

    return { deny: 'ENOENT' }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: have.some(f => e.path.endsWith(f)) }))
  // `node scripts/sdlc-config.cjs layout` answers with `layout` (empty: no settings, so this repository's layout applies)
  on('process.run', () => ({ value: { exitCode: 0, stdout: layout, stderr: '', isStdoutTruncated: false } }))
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

// A project whose tests sit beside the source (src/**/*.test.ts) and whose backlog is docs/items.
const BESIDE = JSON.stringify({
  root: '/work/app', backlogDir: 'docs/items', sourceDirs: ['.'], testFiles: 'files matching src/**/*.test.ts',
  testPatterns: ['^src/(?:.*/)?[^/]*\\.test\\.ts$'],
})

test('the project layout decides what is a test: tests beside the source, absolute paths, another backlog folder', async ($, on) => {
  repo($, on, 'Implement', [], BESIDE)
  expect((await write($, '/work/app/src/a.test.ts')).deny).toMatch(/the tests \(files matching src\/\*\*\/\*\.test\.ts\) are read-only/)
  expect((await write($, 'src/deep/b.test.ts')).deny).toMatch(/read-only/)
  expect((await write($, '/work/app/src/a.ts')).deny).toBeUndefined()
  expect((await write($, 'server/__tests__/a.test.js')).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'rm src/a.test.ts' })).deny).toMatch(/read-only/)
  expect((await $.tool.call({ tool: 'Bash', command: 'rm src/a.ts' })).deny).toBeUndefined()
})

test('with another layout, Red tests writes only tests and Spec only its own backlog folder', async ($, on) => {
  repo($, on, 'Red tests', ['plan-1.md'], BESIDE)
  expect((await write($, 'src/a.test.ts')).deny).toBeUndefined()
  expect((await write($, 'src/a.ts')).deny).toMatch(/never source/)
  expect((await write($, 'docs/items/demo/test-cases-1.md')).deny).toBeUndefined()
})

test('Spec writes only its own folder in the project\'s backlog', async ($, on) => {
  repo($, on, 'Spec', [], BESIDE)
  expect((await write($, 'docs/items/demo/specs-1.md')).deny).toBeUndefined()
  expect((await write($, 'Docs/backlog/demo/specs-1.md')).deny).toMatch(/only docs\/items\/demo\/ may be written/)
})

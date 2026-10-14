// node:test reporter for the SDLC runner adapter (scripts/sdlc-runners.cjs): one JSON line per test start and result.
//   node --test --test-reporter=./scripts/sdlc-node-test-reporter.mjs --test-reporter-destination=<out.jsonl> ...
// Works on Node 18.20+, 20 and 22: it reads only name, nesting, file, skip, todo, details.type and details.error.
export default async function* sdlcNodeTestReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:start' && event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data || {};
    const err = d.details && d.details.error;
    const cause = err && err.cause;
    yield JSON.stringify({
      event: event.type.slice(5),
      name: d.name,
      nesting: d.nesting || 0,
      file: d.file || null,
      suite: Boolean(d.details && d.details.type === 'suite'),
      skip: d.skip !== undefined && d.skip !== false,
      todo: d.todo !== undefined && d.todo !== false,
      failureType: (err && err.failureType) || null,
      message: err ? String((cause && cause.message) || err.message || '').slice(0, 2000) : null,
    }) + '\n';
  }
}

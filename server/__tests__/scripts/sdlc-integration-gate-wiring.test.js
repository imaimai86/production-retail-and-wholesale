const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlcPath = path.join(root, 'scripts/sdlc.sh');
const sdlc = fs.readFileSync(sdlcPath, 'utf8');

const between = (text, startRe, endRe) => {
  const s = text.search(startRe);
  if (s < 0) return '';
  const rest = text.slice(s + 1);
  const e = rest.search(endRe);
  return e < 0 ? text.slice(s) : text.slice(s, s + 1 + e);
};

const planStage = between(sdlc, /stage "2\/6 Plan"/, /stage "3\/6 Red tests/);
const redStage = between(sdlc, /stage "3\/6 Red tests/, /stage "4\/6 Implement/);
const implementStage = between(sdlc, /stage "4\/6 Implement/, /stage "5\/6 Review/);
const reviewStage = sdlc.slice(sdlc.search(/stage "5\/6 Review/));
const GATE_RE = /sdlc-integration-gate\.cjs|\$GATE/;

describe('scripts/sdlc.sh integration-test gate wiring', () => {
  test('stage slices were found', () => {
    [planStage, redStage, implementStage, reviewStage].forEach(s => expect(s.length).toBeGreaterThan(0));
  });

  test('AC11 Plan prompt names the section', () => {
    expect(planStage).toContain('## DB and API changes');
  });

  test('AC11 Plan prompt lists the bullet forms and "- none"', () => {
    expect(planStage).toContain('- none');
    expect(planStage).toMatch(/API: /);
    expect(planStage).toMatch(/DB: migration/);
    expect(planStage).toMatch(/DB: table/);
    expect(planStage).toMatch(/DB: column/);
    expect(planStage).toMatch(/DB: model/);
  });

  test('AC11 Red tests prompt names the section and the integration directory', () => {
    expect(redStage).toContain('## DB and API changes');
    expect(redStage).toContain('server/__tests__/integration/');
  });

  test('AC11 Red tests prompt points at the reference test and helper', () => {
    expect(redStage).toContain('api.integration.test.js');
    expect(redStage).toContain('scratchDb');
    expect(redStage).toContain('supertest');
  });

  test('AC11 existing Red tests prompt rules stay', () => {
    expect(redStage).toContain('Tests must exercise the code under test by importing or running it.');
    expect(redStage).toContain('Do NOT change source code outside');
  });

  test('AC12 staging precedes the plan check, which precedes the integration red check and verdict', () => {
    const add = redStage.indexOf('git add "$DOCS" "$TEST_DIR"');
    const plan = redStage.search(new RegExp(`(${GATE_RE.source})[^\\n]* plan `));
    const red = redStage.indexOf('scripts/sdlc-integration.sh');
    const verdict = redStage.indexOf('RED GATE FAILED: new integration tests pass');
    const commit = redStage.indexOf('git commit -q -m "test($SLUG): add failing tests');
    expect(add).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(add);
    expect(red).toBeGreaterThan(plan);
    expect(verdict).toBeGreaterThan(red);
    expect(commit).toBeGreaterThan(verdict);
  });

  test('AC12 the unit-only red gate line stays and comes first', () => {
    const unit = redStage.indexOf('RED GATE FAILED: new tests pass before implementation');
    const integ = redStage.indexOf('RED GATE FAILED: new integration tests pass');
    expect(unit).toBeGreaterThan(-1);
    expect(unit).toBeLessThan(integ);
  });

  test('AC13 exit 0 handling message', () => {
    expect(sdlc).toContain('RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log');
  });

  test('AC13 exit 3 handling message', () => {
    expect(sdlc).toContain('ERROR: no database for the integration red check (set DATABASE_URL or start Docker)');
  });

  test('AC13 integration red check writes $LOG/integration.log and captures the exit code', () => {
    expect(redStage).toMatch(/sdlc-integration\.sh[^\n]*integration\.log/);
    expect(redStage).toMatch(/\|\|\s*\w+=\$\?/);
  });

  test('AC14 diff gate runs in the Implement loop, before success_check', () => {
    const call = implementStage.search(/diff "\$RED_SHA" "\$INT_RED_SHA"/);
    expect(call).toBeGreaterThan(-1);
    expect(implementStage.slice(0, call + 40)).toMatch(GATE_RE);
    const success = implementStage.indexOf('success_check');
    expect(success).toBeGreaterThan(call);
  });

  test('AC14 diff gate runs after Review starts, before its success_check', () => {
    const call = reviewStage.search(/diff "\$RED_SHA" "\$INT_RED_SHA"/);
    expect(call).toBeGreaterThan(-1);
    const success = reviewStage.indexOf('success_check');
    expect(success).toBeGreaterThan(call);
  });

  test('AC14 a reject of the diff gate stops the run', () => {
    const l = sdlc.split('\n').filter(x => /diff "\$RED_SHA" "\$INT_RED_SHA"/.test(x));
    expect(l.length).toBeGreaterThanOrEqual(2);
    l.forEach(x => expect(x).toMatch(/\|\|\s*exit 1/));
  });

  test('AC14 INT_RED_SHA is the original red-tests commit found by grep', () => {
    expect(sdlc).toMatch(/INT_RED_SHA=\$\(git log[^\n]*--grep="\^test\(\$SLUG\): add failing tests"/);
  });

  test('AC15 CI skip condition for the integration red check', () => {
    expect(redStage).toContain('-n "${CI:-}"');
    expect(redStage).toContain('"${SDLC_INTEGRATION_CI:-}" != "run"');
  });

  test('no success_check call is added to the Red tests stage', () => {
    expect(redStage).not.toContain('success_check');
  });

  test('no opt-out switch', () => {
    expect(sdlc).not.toMatch(/SDLC_INTEGRATION=/);
  });

  test('AC16 bash -n passes on scripts/sdlc.sh', () => {
    const r = spawnSync('bash', ['-n', sdlcPath], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});

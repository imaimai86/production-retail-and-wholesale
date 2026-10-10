const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..', '..');
const sdlc = fs.readFileSync(path.join(root, 'scripts', 'sdlc.sh'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'scripts', 'sdlc-mod.sh'), 'utf8');
const at = (text, needle) => {
  const i = text.indexOf(needle);
  if (i < 0) throw new Error(`not found: ${needle}`);
  return i;
};

describe('require-integration-tests wiring in scripts/sdlc.sh', () => {
  test('the Plan prompt requires the DB and API changes section, and it is checked right after the plan is written', () => {
    const plan = sdlc.slice(at(sdlc, 'agent plan "'), at(sdlc, '# 3. RED TESTS'));
    expect(plan).toContain("'## DB and API changes'");
    expect(plan).toContain('- none');
    expect(plan.indexOf('Plan not produced')).toBeLessThan(plan.indexOf('$GATE section'));
  });

  test('the Red tests prompt asks for integration tests named after each plan bullet', () => {
    const red = sdlc.slice(at(sdlc, 'agent tests "'), at(sdlc, 'PLAN_KIND='));
    expect(red).toContain('$TEST_DIR/integration/');
    expect(red).toContain('api.integration.test.js');
    expect(red).toContain('describe or test title');
    expect(red).toContain("'## Integration tests'");
  });

  test('the plan check runs before the red gate, and the integration red check before the tests are committed', () => {
    const planCheck = at(sdlc, '$GATE plan "$DOCS/plan-1.md" "$TEST_DIR"');
    const redGate = at(sdlc, 'RED GATE FAILED: new tests pass before implementation');
    const redCheck = at(sdlc, 'rc=0; bash scripts/sdlc-integration.sh > "$LOG/integration.log"');
    const commit = at(sdlc, 'git add "$DOCS" "$TEST_DIR"');
    expect(planCheck).toBeLessThan(redGate);
    expect(redGate).toBeLessThan(redCheck);
    expect(redCheck).toBeLessThan(commit);
  });

  test('the integration red check handles every exit code and the temporary CI skip', () => {
    expect(sdlc).toContain('1) echo " integration tests fail as expected (red)"');
    expect(sdlc).toContain('RED GATE FAILED: new integration tests pass before implementation. See $LOG/integration.log');
    expect(sdlc).toContain('ERROR: no database for the integration red check (set DATABASE_URL or start Docker)');
    expect(sdlc).toContain('integration red check skipped in CI');
    expect(sdlc).toMatch(/\[ -n "\$\{CI:-\}" \] && \[ "\$\{SDLC_INTEGRATION_CI:-\}" != "run" \]/);
  });

  test('the diff gate uses the lock commit and the original red commit and runs after each Implement attempt and after Review', () => {
    expect(sdlc).toContain('integration_gate() { $GATE diff "$RED_SHA" "$ORIG_RED_SHA"; }');
    const calls = sdlc.match(/^\s*integration_gate \|\|/gm) || [];
    expect(calls).toHaveLength(2);
    const loopGuard = at(sdlc, 'GUARD FAILED: tests were modified during implementation');
    const reviewGuard = at(sdlc, 'GUARD FAILED: review modified tests');
    const first = sdlc.indexOf('integration_gate ||');
    const second = sdlc.lastIndexOf('integration_gate ||');
    expect(first).toBeGreaterThan(loopGuard);
    expect(first).toBeLessThan(at(sdlc, 'if success_check; then'));
    expect(second).toBeGreaterThan(reviewGuard);
  });

  test('there is no switch that turns the requirement off', () => {
    expect(sdlc).not.toMatch(/SDLC_(SKIP|NO|DISABLE)_?INTEGRATION/i);
    expect(sdlc).not.toMatch(/INTEGRATION_GATE=off/i);
  });

  test('sdlc.sh, the helper and the gate script are syntactically valid', () => {
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts', 'sdlc.sh')]).status).toBe(0);
    expect(spawnSync('bash', ['-n', path.join(root, 'scripts', 'sdlc-integration.sh')]).status).toBe(0);
    expect(spawnSync('node', ['--check', path.join(root, 'scripts', 'sdlc-integration-gate.cjs')]).status).toBe(0);
  });
});

describe('the parallel wrapper scripts/sdlc-mod.sh inherits the requirement', () => {
  test('it runs the unchanged scripts/sdlc.sh in each worktree', () => {
    expect(mod).toContain('exec bash scripts/sdlc.sh "$slug"');
  });

  test('it does not set variables that would skip the integration steps', () => {
    expect(mod).not.toMatch(/export\s+CI=/);
    expect(mod).not.toMatch(/SDLC_INTEGRATION_CI=/);
    expect(mod).not.toMatch(/sdlc-integration/);
  });

  test('it shares the repo-root .env with each worktree, which the integration red check reads', () => {
    expect(mod).toMatch(/for p in [^;]*\.env[^;]*; do/);
  });
});

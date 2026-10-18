const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'sdlc-permissions.cjs');
const { extract, rulesFor, modeFor, decide, ruleFor, loadState } = require(SCRIPT);

const CWD = '/work/repo';
let dir;
let files;

const agentJson = (denials, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', result: 'agent text', permission_denials: denials, ...extra });
const denial = (tool, input) => ({ tool_name: tool, tool_use_id: 'x', tool_input: input });
const run = (json, stage = 'implement', err = '') => {
  fs.writeFileSync(files.json, json);
  if (err) fs.writeFileSync(files.err, err);

  return extract({ jsonFile: files.json, logFile: files.log, stateFile: files.state, stage, cwd: CWD, errFile: err ? files.err : undefined });
};

let dirs = [];
// A new, empty run folder. Every test starts with one; a test that checks several cases calls it between them.
function fresh() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-perm-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'logs'));
  files = { json: path.join(dir, 'a.json'), log: path.join(dir, 'a.log'), err: path.join(dir, 'a.err'), state: path.join(dir, 'logs', 'permissions.json'), repo: path.join(dir, 'repo.json') };
}
beforeEach(fresh);
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('extract', () => {
  test('writes the agent text to the log and records each refused action as pending, once, unless it was already decided', () => {
    const two = () => agentJson([denial('Bash', { command: 'git push origin main' }), denial('Edit', { file_path: `${CWD}/server/app.js` })]);

    expect(run(two())).toBe(2);
    expect(fs.readFileSync(files.log, 'utf8')).toBe('agent text\n');
    const { pending } = loadState(files.state);
    expect(pending[0]).toEqual({ stage: 'implement', tool: 'Bash', detail: 'git push origin main', rule: 'Bash(git push:*)', protected: false });
    expect(pending[1]).toEqual({ stage: 'implement', tool: 'Edit', detail: 'server/app.js', rule: 'Edit(./server/app.js)', protected: false });

    // the same refusals again are still two pending asks
    expect(run(two())).toBe(2);

    // one the developer already denied or allowed is not asked again
    decide(files.state, '0', 'deny', files.repo);
    decide(files.state, '0', 'allow', files.repo);
    expect(run(two())).toBe(0);

    // a file under .claude/ is marked protected, because no allow rule lifts that refusal
    fresh();
    run(agentJson([denial('Edit', { file_path: `${CWD}/.claude/plugins/p/hooks/register.tsx` })]));
    const [ask] = loadState(files.state).pending;
    expect(ask.protected).toBe(true);
    expect(ask.rule).toBe('Edit(./.claude/plugins/p/hooks/register.tsx)');
  });

  test('a run with no refusals leaves nothing pending: an error and a non-success end are kept in the log, non-JSON output is copied unchanged', () => {
    expect(run(agentJson([], { subtype: 'error_max_turns', result: undefined }), 'plan', 'provider said 429\n')).toBe(0);
    expect(fs.readFileSync(files.log, 'utf8')).toContain('[agent ended: error_max_turns]');
    expect(fs.readFileSync(files.log, 'utf8')).toContain('provider said 429');

    fresh();
    expect(run('plain text from an older agent\n', 'plan', 'warn\n')).toBe(0);
    expect(fs.readFileSync(files.log, 'utf8')).toBe('plain text from an older agent\nwarn\n');
  });
});

describe('decide', () => {
  const ask = () => run(agentJson([denial('Bash', { command: 'git push origin main' }), denial('Edit', { file_path: `${CWD}/.claude/plugins/p/f.tsx` })]));

  test('allow grants the rule for this run only; always also saves it in the repository file, which every later run reads', () => {
    ask();
    expect(decide(files.state, '0', 'allow', files.repo)).toBe(1);
    expect(loadState(files.state).allow).toEqual(['Bash(git push:*)']);
    expect(fs.existsSync(files.repo)).toBe(false);
    expect(rulesFor(dir, files.repo)).toEqual(['Bash(git push:*)']);

    fresh();
    ask();
    decide(files.state, '0', 'always', files.repo);
    expect(JSON.parse(fs.readFileSync(files.repo, 'utf8')).allow).toEqual(['Bash(git push:*)']);
    fs.rmSync(files.state);
    expect(rulesFor(dir, files.repo)).toEqual(['Bash(git push:*)']);
  });

  test('allowing a protected path runs that stage with the checks off, and never saves it as a rule', () => {
    ask();

    expect(modeFor(dir, 'implement')).toBe('acceptEdits');
    decide(files.state, '1', 'always', files.repo);
    expect(modeFor(dir, 'implement')).toBe('bypassPermissions');
    expect(modeFor(dir, 'review')).toBe('acceptEdits');
    expect(fs.existsSync(files.repo)).toBe(false);
    expect(loadState(files.state).allow).toEqual([]);
  });

  test('an unknown choice or number is an error and changes nothing; all decides every pending ask, and deny grants nothing', () => {
    ask();

    expect(() => decide(files.state, '0', 'maybe', files.repo)).toThrow(/allow, always or deny/);
    expect(() => decide(files.state, '9', 'allow', files.repo)).toThrow(/no pending request/);
    expect(loadState(files.state).pending).toHaveLength(2);

    expect(decide(files.state, 'all', 'deny', files.repo)).toBe(0);
    const s = loadState(files.state);
    expect(s.denied).toHaveLength(2);
    expect(s.allow).toEqual([]);
    expect(s.bypass).toEqual([]);
  });
});

describe('ruleFor', () => {
  test('gives the allow rule for a refused tool call', () => {
    const cases = [
      ['Bash', { command: 'npm install left-pad' }, 'Bash(npm install:*)'],
      ['Bash', { command: 'make' }, 'Bash(make:*)'],
      ['Bash', { command: '$(evil)' }, 'Bash'],
      ['Write', { file_path: `${CWD}/a/b.txt` }, 'Write(./a/b.txt)'],
      ['WebFetch', { url: 'https://x.example' }, 'WebFetch'],
    ];
    for (const [tool, input, rule] of cases) expect([tool, input, ruleFor(tool, input, CWD)]).toEqual([tool, input, rule]);
  });

  test('a command line with several commands is named by its first command that no allow rule covers', () => {
    const allowed = ['Bash(cd:*)', 'Bash(echo:*)', 'Bash(cat:*)', 'Bash(ls:*)', 'Bash(git log *)', 'Bash(pwd)'];
    const cases = [
      // separators inside quotes do not split the command
      [`cd ${CWD}; sed -n '/^- New \`a;b\`/,/x|y/p' brief.md; echo ---`, 'Bash(sed:*)'],
      ['cat a.js; grep -n "x\\|y" b.js; ls s | grep -i p', 'Bash(grep:*)'],
      ['cd server && npm install pino', 'Bash(npm install:*)'],
      ['git log --oneline -3 || git status', 'Bash(git status:*)'],
      ['pwd; pwd --x', 'Bash(pwd:*)'],
      // every part allowed (refused for another reason): the first part, as before
      ['cd server; cat a.js', 'Bash(cd server:*)'],
      ['cd server', 'Bash(cd server:*)'],
    ];
    for (const [command, rule] of cases) expect([command, ruleFor('Bash', { command }, CWD, allowed)]).toEqual([command, rule]);
  });

  test('extract names a refused command line by the part the agent was not allowed, using the run rules too', () => {
    const line = `cd ${CWD}; sed -n 1,5p a.md; echo ---`;
    fs.writeFileSync(files.json, agentJson([denial('Bash', { command: line })]));
    const r = spawnSync('node', [SCRIPT, 'extract', files.json, files.log, files.state, 'spec', CWD], {
      encoding: 'utf8', env: { ...process.env, SDLC_ALLOWED: 'Bash(cd:*)\nBash(echo:*)\n' },
    });
    expect(r.stdout.trim()).toBe('1');
    expect(loadState(files.state).pending[0]).toMatchObject({ detail: line, rule: 'Bash(sed:*)' });

    // once that rule is allowed for the run, the same refusal is not asked again
    decide(files.state, '0', 'allow', files.repo);
    fs.writeFileSync(files.json, agentJson([denial('Bash', { command: line })]));
    expect(extract({ jsonFile: files.json, logFile: files.log, stateFile: files.state, stage: 'spec', cwd: CWD, allowed: ['Bash(cd:*)', 'Bash(echo:*)'] })).toBe(0);
  });
});

describe('command line', () => {
  const cli = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

  test('extract prints the number of pending asks; args and mode print what the next agent run uses; a bad command exits 1', () => {
    // nothing is pending yet
    const bad = cli('decide', files.state, '0', 'allow', files.repo);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/no pending request/);

    fs.writeFileSync(files.json, agentJson([denial('Bash', { command: 'git push origin main' })]));
    const out = cli('extract', files.json, files.log, files.state, 'implement', CWD);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('1');
    expect(cli('decide', files.state, '0', 'allow', files.repo).stdout.trim()).toBe('0');
    expect(cli('args', dir, 'implement', files.repo).stdout.trim()).toBe('Bash(git push:*)');
    expect(cli('mode', dir, 'implement').stdout.trim()).toBe('acceptEdits');
  });
});

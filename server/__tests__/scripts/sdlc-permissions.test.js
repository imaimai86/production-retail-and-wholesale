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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-perm-'));
  fs.mkdirSync(path.join(dir, 'logs'));
  files = { json: path.join(dir, 'a.json'), log: path.join(dir, 'a.log'), err: path.join(dir, 'a.err'), state: path.join(dir, 'logs', 'permissions.json'), repo: path.join(dir, 'repo.json') };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('extract', () => {
  test('writes the agent text to the log and records each refused action as pending', () => {
    const n = run(agentJson([denial('Bash', { command: 'git push origin main' }), denial('Edit', { file_path: `${CWD}/server/app.js` })]));

    expect(n).toBe(2);
    expect(fs.readFileSync(files.log, 'utf8')).toBe('agent text\n');
    const { pending } = loadState(files.state);
    expect(pending[0]).toEqual({ stage: 'implement', tool: 'Bash', detail: 'git push origin main', rule: 'Bash(git push:*)', protected: false });
    expect(pending[1]).toEqual({ stage: 'implement', tool: 'Edit', detail: 'server/app.js', rule: 'Edit(./server/app.js)', protected: false });
  });

  test('a file under .claude/ is marked protected, because no allow rule lifts that refusal', () => {
    run(agentJson([denial('Edit', { file_path: `${CWD}/.claude/plugins/p/hooks/register.tsx` })]));

    const [ask] = loadState(files.state).pending;
    expect(ask.protected).toBe(true);
    expect(ask.rule).toBe('Edit(./.claude/plugins/p/hooks/register.tsx)');
  });

  test('the same refusal twice is one pending ask', () => {
    run(agentJson([denial('Bash', { command: 'rm -rf build' })]));

    expect(run(agentJson([denial('Bash', { command: 'rm -rf build' })]))).toBe(1);
  });

  test('a refusal the developer already denied or allowed is not asked again', () => {
    run(agentJson([denial('Bash', { command: 'git push origin main' }), denial('Bash', { command: 'curl https://x.example' })]));
    decide(files.state, '0', 'deny', files.repo)
    decide(files.state, '0', 'allow', files.repo)

    expect(run(agentJson([denial('Bash', { command: 'git push origin main' }), denial('Bash', { command: 'curl https://x.example' })]))).toBe(0)
  });

  test('a run with no refusals leaves nothing pending, and an error and a non-success end are kept in the log', () => {
    const n = run(agentJson([], { subtype: 'error_max_turns', result: undefined }), 'plan', 'provider said 429\n');

    expect(n).toBe(0);
    expect(fs.readFileSync(files.log, 'utf8')).toContain('[agent ended: error_max_turns]');
    expect(fs.readFileSync(files.log, 'utf8')).toContain('provider said 429');
  });

  test('output that is not JSON is copied to the log unchanged', () => {
    const n = run('plain text from an older agent\n', 'plan', 'warn\n');

    expect(n).toBe(0);
    expect(fs.readFileSync(files.log, 'utf8')).toBe('plain text from an older agent\nwarn\n');
  });
});

describe('decide', () => {
  const ask = () => run(agentJson([denial('Bash', { command: 'git push origin main' }), denial('Edit', { file_path: `${CWD}/.claude/plugins/p/f.tsx` })]));

  test('allow grants the rule for this run only', () => {
    ask();

    expect(decide(files.state, '0', 'allow', files.repo)).toBe(1);
    expect(loadState(files.state).allow).toEqual(['Bash(git push:*)']);
    expect(fs.existsSync(files.repo)).toBe(false);
    expect(rulesFor(dir, files.repo)).toEqual(['Bash(git push:*)']);
  });

  test('always also saves the rule in the repository file, which every later run reads', () => {
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

  test('all decides every pending ask; deny records it and grants nothing', () => {
    ask();

    expect(decide(files.state, 'all', 'deny', files.repo)).toBe(0);
    const s = loadState(files.state);
    expect(s.denied).toHaveLength(2);
    expect(s.allow).toEqual([]);
    expect(s.bypass).toEqual([]);
  });

  test('an unknown choice or number is an error and changes nothing', () => {
    ask();

    expect(() => decide(files.state, '0', 'maybe', files.repo)).toThrow(/allow, always or deny/);
    expect(() => decide(files.state, '9', 'allow', files.repo)).toThrow(/no pending request/);
    expect(loadState(files.state).pending).toHaveLength(2);
  });
});

describe('ruleFor', () => {
  test.each([
    ['Bash', { command: 'npm install left-pad' }, 'Bash(npm install:*)'],
    ['Bash', { command: 'make' }, 'Bash(make:*)'],
    ['Bash', { command: '$(evil)' }, 'Bash'],
    ['Write', { file_path: `${CWD}/a/b.txt` }, 'Write(./a/b.txt)'],
    ['WebFetch', { url: 'https://x.example' }, 'WebFetch'],
  ])('%s %j is allowed by %s', (tool, input, rule) => {
    expect(ruleFor(tool, input, CWD)).toBe(rule);
  });
});

describe('command line', () => {
  const cli = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

  test('extract prints the number of pending asks; args and mode print what the next agent run uses', () => {
    fs.writeFileSync(files.json, agentJson([denial('Bash', { command: 'git push origin main' })]));
    const out = cli('extract', files.json, files.log, files.state, 'implement', CWD);

    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('1');
    expect(cli('decide', files.state, '0', 'allow', files.repo).stdout.trim()).toBe('0');
    expect(cli('args', dir, 'implement', files.repo).stdout.trim()).toBe('Bash(git push:*)');
    expect(cli('mode', dir, 'implement').stdout.trim()).toBe('acceptEdits');
  });

  test('a bad command exits 1 with a message', () => {
    const out = cli('decide', files.state, '0', 'allow', files.repo);

    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/no pending request/);
  });
});

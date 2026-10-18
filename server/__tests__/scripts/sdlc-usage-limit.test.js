const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const agentFn = sdlc.slice(sdlc.indexOf('# agent <log-name> <stage>'), sdlc.indexOf('# manual_input <stage>'));

const LIMIT = JSON.stringify({
  type: 'result', subtype: 'success', is_error: true, api_error_status: 429, api_error: 'usage_limit_reached',
  result: "You've hit your session limit · resets 1:10am (Asia/Dubai)", permission_denials: [],
});
const OK = JSON.stringify({ type: 'result', subtype: 'success', result: 'all done', permission_denials: [] });

// Runs the pipeline's own agent() with a fake `claude` that hits the usage limit on its first `limited` calls, then succeeds.
// set_status records the note it would write, so the test sees what the pane would show.
function runAgent(limited, env = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-limit-'));
  fs.symlinkSync(path.join(root, 'scripts'), path.join(cwd, 'scripts'));
  const bin = path.join(cwd, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(cwd, 'limit.json'), LIMIT);
  fs.writeFileSync(path.join(cwd, 'ok.json'), OK);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash
n=$(( $(cat "${cwd}/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "${cwd}/calls"
if [ "$n" -le ${limited} ]; then cat "${cwd}/limit.json"; exit 1; fi
cat "${cwd}/ok.json"
`, { mode: 0o755 });
  fs.mkdirSync(path.join(cwd, 'Docs/backlog/s/logs'), { recursive: true });
  const script = `set -euo pipefail
ROOT="$PWD"; DOCS=Docs/backlog/s; LOG=$DOCS/logs; SLUG=s; MAX_TURNS=5; PERM_REPO="$PWD/repo-rules.json"; CUR_NOTE=""
LIMIT_RETRY="\${SDLC_LIMIT_RETRY}"; LIMIT_MAX_WAIT="\${SDLC_LIMIT_MAX_WAIT}"
ALLOWED=(Read Edit)
render_prompt() { echo "prompt"; }; manual_input() { :; }; resume_hint() { :; }; apply_provider_env() { :; }
set_status() { echo "note=$CUR_NOTE" >> "$PWD/notes.txt"; }
stage_flags() { STAGE_FLAGS=(--model opus); }
${agentFn}
agent impl-1 implement
echo "agent returned"`;
  const r = spawnSync('bash', ['-c', script], {
    cwd, encoding: 'utf8', env: { ...process.env, SDLC_LIMIT_RETRY: '1', SDLC_LIMIT_MAX_WAIT: '30', ...env, PATH: `${bin}:${process.env.PATH}` },
  });
  const read = f => (fs.existsSync(path.join(cwd, f)) ? fs.readFileSync(path.join(cwd, f), 'utf8') : '');

  return { r, calls: Number(read('calls')), notes: read('notes.txt').trim().split('\n').filter(Boolean), log: read('Docs/backlog/s/logs/impl-1.log') };
}

describe('agent() and the usage limit', () => {
  test('waits for the limit to reset and runs the same agent again, showing the reset time meanwhile', () => {
    const { r, calls, notes, log } = runAgent(2);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("usage limit reached (resets 1:10am (Asia/Dubai)): retrying 'impl-1' every 1s");
    expect(r.stdout).toContain("usage limit over, 'impl-1' ran");
    expect(r.stdout).toContain('agent returned');
    expect(r.stdout).not.toContain('failed');
    expect(calls).toBe(3);
    // no note when the agent starts, the reset time while waiting, cleared once the agent ran
    expect(notes).toEqual(['note=', 'note=usage limit, resets 1:10am (Asia/Dubai)', 'note=usage limit, resets 1:10am (Asia/Dubai)', 'note=']);
    expect(log).toBe('all done\n');
  });

  test('a limit that does not reset within SDLC_LIMIT_MAX_WAIT fails the stage and says why', () => {
    const { r, calls } = runAgent(99, { SDLC_LIMIT_MAX_WAIT: '2' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("agent 'impl-1' hit the usage limit (resets 1:10am (Asia/Dubai)) and it did not reset within 2s");
    expect(r.stdout).not.toContain('agent returned');
    expect(calls).toBe(3);
  });

  test('a run that does not hit the limit calls the agent once and prints nothing about it', () => {
    const { r, calls } = runAgent(0, {});
    expect(r.status).toBe(0);
    expect(calls).toBe(1);
    expect(r.stdout).not.toContain('usage limit');
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const agentFn = sdlc.slice(sdlc.indexOf('# agent <log-name> <stage>'), sdlc.indexOf('# manual_input <stage>'));

// Runs the pipeline's own agent() with a fake `claude` that prints `reply`, in a temp repo that sees the real helper script.
function runAgent(reply, { state, extraArgs = '' } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-agent-'));
  fs.symlinkSync(path.join(root, 'scripts'), path.join(cwd, 'scripts'));
  const bin = path.join(cwd, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\necho "$*" > "${cwd}/claude-args.txt"\ncat <<'EOF'\n${reply}\nEOF\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(cwd, 'Docs/backlog/s/logs'), { recursive: true });
  if (state) fs.writeFileSync(path.join(cwd, 'Docs/backlog/s/logs/permissions.json'), JSON.stringify(state));
  const script = `set -euo pipefail
ROOT="$PWD"; DOCS=Docs/backlog/s; LOG=$DOCS/logs; SLUG=s; MAX_TURNS=5; PERM_REPO="$PWD/repo-rules.json"
ALLOWED=(Read Edit)
render_prompt() { echo "prompt"; }; manual_input() { :; }; set_status() { :; }; resume_hint() { :; }; apply_provider_env() { :; }
stage_flags() { STAGE_FLAGS=(--model opus); }
${agentFn}
agent impl-1 implement ${extraArgs}
echo "agent returned"`;
  const r = spawnSync('bash', ['-c', script], { cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
  const read = f => (fs.existsSync(path.join(cwd, f)) ? fs.readFileSync(path.join(cwd, f), 'utf8') : null);

  return { r, args: read('claude-args.txt'), log: read('Docs/backlog/s/logs/impl-1.log'), state: JSON.parse(read('Docs/backlog/s/logs/permissions.json') || 'null') };
}

const OK = JSON.stringify({ type: 'result', subtype: 'success', result: 'all done', permission_denials: [] });
const REFUSED = JSON.stringify({ type: 'result', subtype: 'success', result: 'x', permission_denials: [{ tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'git push origin main' } }] });

describe('agent() permission handling', () => {
  test('a clean run asks for JSON output, keeps the usual log, and returns; an end without success is kept in the log', () => {
    const { r, args, log } = runAgent(OK);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('agent returned');
    expect(args).toContain('--output-format json');
    expect(args).toContain('--permission-mode acceptEdits');
    expect(log).toBe('all done\n');

    expect(runAgent(OK.replace('success', 'error_max_turns')).log).toContain('[agent ended: error_max_turns]');
  });

  test('a refused action stops the run with exit 2 and records the ask; an allowed rule or protected path lets it run', () => {
    const { r, state } = runAgent(REFUSED);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('agent returned');
    expect(r.stdout).toContain('was refused 1 action(s)');
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({ stage: 'implement', tool: 'Bash', rule: 'Bash(git push:*)' });

    // a rule the developer allowed is passed to claude, and a decided ask no longer stops the run
    const allowed = runAgent(REFUSED, { state: { pending: [], allow: ['Bash(git push:*)'], bypass: [], denied: [] } });
    expect(allowed.r.status).toBe(0);
    expect(allowed.args).toContain('Bash(git push:*)');

    // a protected path the developer allowed runs the stage with the checks off
    const bypass = runAgent(OK, { state: { pending: [], allow: [], bypass: ['implement'], denied: [] } });
    expect(bypass.r.status).toBe(0);
    expect(bypass.args).toContain('--permission-mode bypassPermissions');
    expect(bypass.r.stdout).toContain('permission checks are off for this stage');
  });
});

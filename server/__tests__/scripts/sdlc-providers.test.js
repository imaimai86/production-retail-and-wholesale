const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const fn = sdlc.slice(sdlc.indexOf('# Default per stage'), sdlc.indexOf('load_env_models\nMODELS_JSON'));

const PROVIDER_ENV = {
  SDLC_PROVIDERS: 'openrouter, local',
  SDLC_PROVIDER_OPENROUTER_ENDPOINT: 'https://gw.example/api',
  SDLC_PROVIDER_OPENROUTER_API_KEY: 'sk-secret-1',
  SDLC_PROVIDER_OPENROUTER_MODELS: 'openai/gpt-5,google/gemini-2.5-pro',
  SDLC_PROVIDER_LOCAL_ENDPOINT: 'http://localhost:4000',
  SDLC_PROVIDER_LOCAL_API_KEY: 'sk-local',
  SDLC_PROVIDER_LOCAL_MODELS: 'llama3:8b',
  SDLC_PROVIDER_LOCAL_EFFORT: 'yes',
};

function bash(script, env = {}, cwd = os.tmpdir()) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SDLC_|MODEL_|EFFORT_|ANTHROPIC_)/.test(k)));
  // ROOT lets the pipeline block find the registry helper from a temp cwd; the registry file never exists here.
  const base = { ROOT: root, SDLC_MODELS_FILE: path.join(os.tmpdir(), 'sdlc-no-registry', 'models.json') };
  return spawnSync('bash', ['-c', `set -euo pipefail\n${fn}\n${script}`], { cwd, env: { ...clean, ...base, ...env }, encoding: 'utf8' });
}

describe('resolve_provider', () => {
  test('an Anthropic model sets nothing; provider/model splits on the first slash; _EFFORT=yes passes --effort', () => {
    // a model without a slash is an Anthropic model
    let r = bash('resolve_provider opus review; echo "$PV_ACTIVE|$PV_MODEL|$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('0|opus|1');

    // the rest of the name is kept
    r = bash('resolve_provider openrouter/openai/gpt-5 implement; echo "$PV_ACTIVE|$PV_MODEL|$PV_ENDPOINT|$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('1|openai/gpt-5|https://gw.example/api|0');

    r = bash('resolve_provider local/llama3:8b implement; echo "$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('1');
  });

  test('an unlisted provider, an unlisted model and a provider without endpoint or key exit 1 and say what to configure', () => {
    let r = bash('resolve_provider acme/foo plan', PROVIDER_ENV);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("provider 'acme' is not listed in SDLC_PROVIDERS");

    r = bash('resolve_provider openrouter/other plan', PROVIDER_ENV);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("model 'other' (stage plan) is not in SDLC_PROVIDER_OPENROUTER_MODELS");
    expect(r.stderr).toContain('openai/gpt-5,google/gemini-2.5-pro');

    r = bash('resolve_provider openrouter/openai/gpt-5 plan', { ...PROVIDER_ENV, SDLC_PROVIDER_OPENROUTER_API_KEY: '' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('needs SDLC_PROVIDER_OPENROUTER_ENDPOINT and SDLC_PROVIDER_OPENROUTER_API_KEY');
  });
});

describe('stage_flags and apply_provider_env', () => {
  const stub = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-claude-'));
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/bash\necho "ARGS:$*"\necho "BASE:${ANTHROPIC_BASE_URL-unset}"\necho "TOKEN:${ANTHROPIC_AUTH_TOKEN-unset}"\necho "APIKEY:${ANTHROPIC_API_KEY-unset}"\necho "HAIKU:${ANTHROPIC_DEFAULT_HAIKU_MODEL-unset}"\n', { mode: 0o755 });
    return dir;
  };
  const run = (modelEnv) => {
    const bin = stub();
    const script = 'stage_flags implement; (apply_provider_env; claude "${STAGE_FLAGS[@]}"); echo "OUTER:${ANTHROPIC_AUTH_TOKEN-unset}|$CUR_MODEL"';
    return bash(script, { ...PROVIDER_ENV, ...modelEnv, PATH: `${bin}:${process.env.PATH}`, ANTHROPIC_API_KEY: 'sk-ant-real' });
  };

  test('an Anthropic model gets --model and --effort and no provider environment; a provider with _EFFORT=yes gets --effort too', () => {
    let r = run({});
    expect(r.stdout).toContain('ARGS:--model sonnet --effort medium');
    expect(r.stdout).toContain('BASE:unset');
    expect(r.stdout).toContain('APIKEY:sk-ant-real');

    r = run({ MODEL_IMPLEMENT: 'local/llama3:8b', EFFORT_IMPLEMENT: 'high' });
    expect(r.stdout).toContain('ARGS:--model llama3:8b --effort high');
  });

  test('a custom provider gets its endpoint and key, an emptied Anthropic key and the bare model name; the key stays inside the subshell', () => {
    const r = run({ MODEL_IMPLEMENT: 'openrouter/openai/gpt-5' });
    expect(r.stdout).toContain('ARGS:--model openai/gpt-5\n');
    expect(r.stdout).toContain('BASE:https://gw.example/api');
    expect(r.stdout).toContain('TOKEN:sk-secret-1');
    expect(r.stdout).toContain('APIKEY:\n');
    expect(r.stdout).toContain('HAIKU:openai/gpt-5');
    expect(r.stdout).not.toContain('sk-ant-real');

    // the status keeps the provider/model name
    expect(r.stdout).toContain('OUTER:unset|openrouter/openai/gpt-5');
    // the key is never printed by stage_flags
    expect(r.stdout.split('\n').filter(l => l.startsWith('   model='))[0]).not.toContain('sk-secret');
  });
});

describe('load_env_models', () => {
  const dirWith = content => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-env-'));
    if (content !== null) fs.writeFileSync(path.join(dir, '.env'), content);
    return dir;
  };

  test('reads only SDLC_PROVIDER* keys from .env, strips quotes, never exports the rest; the shell wins; a missing .env is fine', () => {
    let dir = dirWith('DATABASE_URL=postgres://x\nSDLC_PROVIDERS="openrouter"\nSDLC_PROVIDER_OPENROUTER_API_KEY=\'k-1\'\nADMIN_TOKEN=t\n');
    let r = bash('load_env_models; echo "$SDLC_PROVIDERS|$SDLC_PROVIDER_OPENROUTER_API_KEY|${DATABASE_URL-unset}|${ADMIN_TOKEN-unset}"', {}, dir);
    expect(r.stdout.trim()).toBe('openrouter|k-1|unset|unset');

    dir = dirWith('SDLC_PROVIDERS=fromfile\n');
    r = bash('load_env_models; echo "$SDLC_PROVIDERS"', { SDLC_PROVIDERS: 'fromshell' }, dir);
    expect(r.stdout.trim()).toBe('fromshell');

    expect(bash('load_env_models; echo ok', {}, dirWith(null)).stdout.trim()).toBe('ok');
  });
});

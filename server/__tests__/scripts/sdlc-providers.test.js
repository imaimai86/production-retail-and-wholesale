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
  return spawnSync('bash', ['-c', `set -euo pipefail\n${fn}\n${script}`], { cwd, env: { ...clean, ...env }, encoding: 'utf8' });
}

describe('resolve_provider', () => {
  test('a model without a slash is an Anthropic model and nothing is set', () => {
    const r = bash('resolve_provider opus review; echo "$PV_ACTIVE|$PV_MODEL|$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('0|opus|1');
  });

  test('provider/model splits on the first slash and keeps the rest of the name', () => {
    const r = bash('resolve_provider openrouter/openai/gpt-5 implement; echo "$PV_ACTIVE|$PV_MODEL|$PV_ENDPOINT|$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('1|openai/gpt-5|https://gw.example/api|0');
  });

  test('_EFFORT=yes passes --effort for that provider', () => {
    const r = bash('resolve_provider local/llama3:8b implement; echo "$PV_EFFORT_FLAG"', PROVIDER_ENV);
    expect(r.stdout.trim()).toBe('1');
  });

  test('an unlisted provider exits 1 and says where to configure it', () => {
    const r = bash('resolve_provider acme/foo plan', PROVIDER_ENV);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("provider 'acme' is not listed in SDLC_PROVIDERS");
  });

  test('a model the provider does not list exits 1 and names the allowed ones', () => {
    const r = bash('resolve_provider openrouter/other plan', PROVIDER_ENV);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("model 'other' (stage plan) is not in SDLC_PROVIDER_OPENROUTER_MODELS");
    expect(r.stderr).toContain('openai/gpt-5,google/gemini-2.5-pro');
  });

  test('a provider without endpoint or key exits 1', () => {
    const env = { ...PROVIDER_ENV, SDLC_PROVIDER_OPENROUTER_API_KEY: '' };
    const r = bash('resolve_provider openrouter/openai/gpt-5 plan', env);
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

  test('an Anthropic model gets --model and --effort and no provider environment', () => {
    const r = run({});
    expect(r.stdout).toContain('ARGS:--model sonnet --effort medium');
    expect(r.stdout).toContain('BASE:unset');
    expect(r.stdout).toContain('APIKEY:sk-ant-real');
  });

  test('a custom provider gets its endpoint and key, an emptied Anthropic key and the bare model name', () => {
    const r = run({ MODEL_IMPLEMENT: 'openrouter/openai/gpt-5' });
    expect(r.stdout).toContain('ARGS:--model openai/gpt-5\n');
    expect(r.stdout).toContain('BASE:https://gw.example/api');
    expect(r.stdout).toContain('TOKEN:sk-secret-1');
    expect(r.stdout).toContain('APIKEY:\n');
    expect(r.stdout).toContain('HAIKU:openai/gpt-5');
    expect(r.stdout).not.toContain('sk-ant-real');
  });

  test('the key stays inside the subshell and the status keeps the provider/model name', () => {
    const r = run({ MODEL_IMPLEMENT: 'openrouter/openai/gpt-5' });
    expect(r.stdout).toContain('OUTER:unset|openrouter/openai/gpt-5');
  });

  test('--effort is passed for a provider with _EFFORT=yes', () => {
    const r = run({ MODEL_IMPLEMENT: 'local/llama3:8b', EFFORT_IMPLEMENT: 'high' });
    expect(r.stdout).toContain('ARGS:--model llama3:8b --effort high');
  });

  test('the key is never printed by stage_flags', () => {
    const r = run({ MODEL_IMPLEMENT: 'openrouter/openai/gpt-5' });
    expect(r.stdout.split('\n').filter(l => l.startsWith('   model='))[0]).not.toContain('sk-secret');
  });
});

describe('load_env_models', () => {
  const dirWith = content => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-env-'));
    fs.writeFileSync(path.join(dir, '.env'), content);
    return dir;
  };

  test('reads only SDLC_PROVIDER* keys from .env, strips quotes, and never exports the rest', () => {
    const dir = dirWith('DATABASE_URL=postgres://x\nSDLC_PROVIDERS="openrouter"\nSDLC_PROVIDER_OPENROUTER_API_KEY=\'k-1\'\nADMIN_TOKEN=t\n');
    const r = bash('load_env_models; echo "$SDLC_PROVIDERS|$SDLC_PROVIDER_OPENROUTER_API_KEY|${DATABASE_URL-unset}|${ADMIN_TOKEN-unset}"', {}, dir);
    expect(r.stdout.trim()).toBe('openrouter|k-1|unset|unset');
  });

  test('a value already in the shell wins over .env', () => {
    const dir = dirWith('SDLC_PROVIDERS=fromfile\n');
    const r = bash('load_env_models; echo "$SDLC_PROVIDERS"', { SDLC_PROVIDERS: 'fromshell' }, dir);
    expect(r.stdout.trim()).toBe('fromshell');
  });

  test('a missing .env is fine', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-env-'));
    expect(bash('load_env_models; echo ok', {}, dir).stdout.trim()).toBe('ok');
  });
});

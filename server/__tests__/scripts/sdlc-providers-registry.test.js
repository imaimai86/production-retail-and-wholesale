const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const helper = path.join(root, 'scripts/sdlc-models.cjs');
const sdlc = fs.readFileSync(path.join(root, 'scripts/sdlc.sh'), 'utf8');
const fn = sdlc.slice(sdlc.indexOf('# Default per stage'), sdlc.indexOf('load_env_models\nMODELS_JSON'));

const KEY = 'sk-reg-secret-1';
let tmp;
let regFile;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-reg-'));
  regFile = path.join(tmp, 'models.json');
});

const registry = (providers, f = regFile) => fs.writeFileSync(f, JSON.stringify({ providers }));
const REG = { reg: { endpoint: 'https://reg.example/api', api_key_env: 'REG_KEY', models: ['m1', 'org/m2'], effort: false } };

function bash(script, env = {}, cwd = tmp) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SDLC_|MODEL_|EFFORT_|ANTHROPIC_|REG_KEY)/.test(k)));
  return spawnSync('bash', ['-c', `set -euo pipefail\n${fn}\n${script}`], {
    cwd, encoding: 'utf8', env: { ...clean, ROOT: root, SDLC_MODELS_FILE: regFile, ...env },
  });
}
const resolve = (spec, env, cwd) => bash(`resolve_provider ${spec} implement; echo "$PV_ACTIVE|$PV_MODEL|$PV_ENDPOINT|$PV_KEY|$PV_EFFORT_FLAG"`, env, cwd);
const ENVP = {
  SDLC_PROVIDERS: 'envp', SDLC_PROVIDER_ENVP_ENDPOINT: 'https://env.example', SDLC_PROVIDER_ENVP_API_KEY: 'sk-env', SDLC_PROVIDER_ENVP_MODELS: 'x',
};

describe('resolve_provider with the registry', () => {
  test('AC34 a registry-only provider resolves with the key from the variable', () => {
    registry(REG);
    const r = resolve('reg/org/m2', { REG_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`1|org/m2|https://reg.example/api|${KEY}|0`);
  });
  test('AC35 effort true gives flag 1; false or absent gives 0', () => {
    registry({ reg: { ...REG.reg, effort: true } });
    expect(resolve('reg/m1', { REG_KEY: KEY }).stdout.trim().split('|')[4]).toBe('1');
    registry({ reg: { ...REG.reg, effort: false } });
    expect(resolve('reg/m1', { REG_KEY: KEY }).stdout.trim().split('|')[4]).toBe('0');
    const noEffort = { ...REG.reg };
    delete noEffort.effort;
    registry({ reg: noEffort });
    expect(resolve('reg/m1', { REG_KEY: KEY }).stdout.trim().split('|')[4]).toBe('0');
  });
  test('AC36 a provider in both: the registry wins as a whole', () => {
    registry({ openrouter: { endpoint: 'https://reg.example/api', api_key_env: 'REG_KEY', models: ['only-reg'] } });
    const env = {
      REG_KEY: KEY,
      SDLC_PROVIDERS: 'openrouter',
      SDLC_PROVIDER_OPENROUTER_ENDPOINT: 'https://env.example',
      SDLC_PROVIDER_OPENROUTER_API_KEY: 'sk-from-env',
      SDLC_PROVIDER_OPENROUTER_MODELS: 'only-env',
      SDLC_PROVIDER_OPENROUTER_EFFORT: 'yes',
    };
    const r = resolve('openrouter/only-reg', env);
    expect(r.stdout.trim()).toBe(`1|only-reg|https://reg.example/api|${KEY}|0`);
    const bad = resolve('openrouter/only-env', env);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('only-env');
  });
  test('AC37 a provider only in SDLC_PROVIDER* still works with its own key', () => {
    registry(REG);
    expect(resolve('envp/x', ENVP).stdout.trim()).toBe('1|x|https://env.example|sk-env|0');
  });
  test('AC37 same with no registry file at all', () => {
    expect(resolve('envp/x', ENVP).stdout.trim()).toBe('1|x|https://env.example|sk-env|0');
  });
  test('AC38 key variable unset or empty: exit 1 naming the variable', () => {
    registry(REG);
    for (const env of [{}, { REG_KEY: '' }]) {
      const r = resolve('reg/m1', env);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REG_KEY');
    }
  });
  test('AC38 the .env-style provider key does not rescue a registry provider', () => {
    registry({ openrouter: { ...REG.reg } });
    const r = resolve('openrouter/m1', { SDLC_PROVIDERS: 'openrouter', SDLC_PROVIDER_OPENROUTER_API_KEY: 'sk-from-env' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REG_KEY');
  });
  test('AC39 a key variable only in .env is not used', () => {
    registry(REG);
    fs.writeFileSync(path.join(tmp, '.env'), `REG_KEY=${KEY}\n`);
    const r = resolve('reg/m1', {}, tmp);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REG_KEY');
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });
  test('AC40 a model not in the list exits 1 naming the model and the allowed list', () => {
    registry(REG);
    const r = resolve('reg/other', { REG_KEY: KEY });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('other');
    expect(r.stderr).toContain('m1,org/m2');
  });
  test('AC41 a provider in neither place keeps the existing message', () => {
    registry(REG);
    const r = resolve('acme/foo', { SDLC_PROVIDERS: 'envp' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("provider 'acme' is not listed in SDLC_PROVIDERS");
  });
  test('AC42 the registry is read on every call', () => {
    registry(REG);
    const script = [
      'resolve_provider reg/m1 plan',
      '(resolve_provider reg/new plan) 2>/dev/null && echo FIRST_OK || echo FIRST_FAIL',
      `node "${helper}" add-model reg new >/dev/null`,
      'resolve_provider reg/new plan; echo "LAST:$PV_MODEL"',
    ].join('\n');
    const r = bash(script, { REG_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('FIRST_FAIL');
    expect(r.stdout).toContain('LAST:new');
  });
  test('AC43 a corrupt registry file exits 1 with its path', () => {
    fs.writeFileSync(regFile, '{ broken');
    const r = resolve('reg/m1', { REG_KEY: KEY });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(regFile);
  });
  test('AC43 a corrupt registry also fails registry_check at startup', () => {
    fs.writeFileSync(regFile, '{ broken');
    const r = bash('registry_check; echo reached');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(regFile);
    expect(r.stdout).not.toContain('reached');
  });
  test('registry_check passes for a missing file and for a valid one', () => {
    expect(bash('registry_check; echo reached').stdout.trim()).toBe('reached');
    registry(REG);
    expect(bash('registry_check; echo reached').stdout.trim()).toBe('reached');
  });
  test('AC44 no registry file and no SDLC_PROVIDER*: Anthropic models resolve as today', () => {
    const r = bash('resolve_provider opus review; echo "$PV_ACTIVE|$PV_MODEL|$PV_EFFORT_FLAG"');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0|opus|1');
  });
  test('an Anthropic model does not consult a corrupt registry after startup', () => {
    fs.writeFileSync(regFile, '{ broken');
    const r = bash('resolve_provider sonnet plan; echo "$PV_ACTIVE|$PV_MODEL"');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0|sonnet');
  });
});

describe('AC45 apply_provider_env with a registry provider', () => {
  test('the key is visible only inside the agent subshell', () => {
    registry(REG);
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-claude-'));
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/bash\necho "ARGS:$*"\necho "BASE:${ANTHROPIC_BASE_URL-unset}"\necho "TOKEN:${ANTHROPIC_AUTH_TOKEN-unset}"\necho "APIKEY:${ANTHROPIC_API_KEY-unset}"\n', { mode: 0o755 });
    const script = 'stage_flags implement; (apply_provider_env; claude "${STAGE_FLAGS[@]}"); echo "OUTER:${ANTHROPIC_AUTH_TOKEN-unset}|$CUR_MODEL"';
    const r = bash(script, { MODEL_IMPLEMENT: 'reg/m1', REG_KEY: KEY, PATH: `${bin}:${process.env.PATH}`, ANTHROPIC_API_KEY: 'sk-ant-real' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ARGS:--model m1');
    expect(r.stdout).toContain('BASE:https://reg.example/api');
    expect(r.stdout).toContain(`TOKEN:${KEY}`);
    expect(r.stdout).toContain('APIKEY:\n');
    expect(r.stdout).toContain('OUTER:unset|reg/m1');
    expect(r.stdout).not.toContain('sk-ant-real');
    expect(r.stdout.split('\n').filter(l => l.startsWith('   model='))[0] || '').not.toContain(KEY);
  });
});

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
  const effortFlag = effort => {
    const reg = { ...REG.reg, effort };
    if (effort === undefined) delete reg.effort;
    registry({ reg });
    return resolve('reg/m1', { REG_KEY: KEY }).stdout.trim().split('|')[4];
  };

  test('AC34 AC35 AC42 a registry-only provider resolves with the key from its variable; effort sets the flag; the file is read on every call', () => {
    registry(REG);
    let r = resolve('reg/org/m2', { REG_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`1|org/m2|https://reg.example/api|${KEY}|0`);

    // AC42
    const script = [
      'resolve_provider reg/m1 plan',
      '(resolve_provider reg/new plan) 2>/dev/null && echo FIRST_OK || echo FIRST_FAIL',
      `node "${helper}" add-model reg new >/dev/null`,
      'resolve_provider reg/new plan; echo "LAST:$PV_MODEL"',
    ].join('\n');
    r = bash(script, { REG_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('FIRST_FAIL');
    expect(r.stdout).toContain('LAST:new');

    // AC35 effort true gives flag 1; false or absent gives 0
    expect([effortFlag(true), effortFlag(false), effortFlag(undefined)]).toEqual(['1', '0', '0']);
  });

  test('AC36 AC37 a provider in both places is the registry one as a whole; one only in SDLC_PROVIDER* keeps its own key', () => {
    // AC37, with no registry file at all and with one
    expect(resolve('envp/x', ENVP).stdout.trim()).toBe('1|x|https://env.example|sk-env|0');
    registry(REG);
    expect(resolve('envp/x', ENVP).stdout.trim()).toBe('1|x|https://env.example|sk-env|0');

    // AC36
    registry({ openrouter: { endpoint: 'https://reg.example/api', api_key_env: 'REG_KEY', models: ['only-reg'] } });
    const env = {
      REG_KEY: KEY,
      SDLC_PROVIDERS: 'openrouter',
      SDLC_PROVIDER_OPENROUTER_ENDPOINT: 'https://env.example',
      SDLC_PROVIDER_OPENROUTER_API_KEY: 'sk-from-env',
      SDLC_PROVIDER_OPENROUTER_MODELS: 'only-env',
      SDLC_PROVIDER_OPENROUTER_EFFORT: 'yes',
    };
    expect(resolve('openrouter/only-reg', env).stdout.trim()).toBe(`1|only-reg|https://reg.example/api|${KEY}|0`);
    const bad = resolve('openrouter/only-env', env);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('only-env');
  });

  test('AC38..41 exit 1 for a key variable that is unset, empty or only in .env, for an unlisted model and for an unknown provider', () => {
    registry(REG);
    // AC38 the message names the variable
    for (const env of [{}, { REG_KEY: '' }]) {
      const r = resolve('reg/m1', env);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('REG_KEY');
    }

    // AC40 the model and the allowed list are named
    let r = resolve('reg/other', { REG_KEY: KEY });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('other');
    expect(r.stderr).toContain('m1,org/m2');

    // AC41 a provider in neither place keeps the existing message
    r = resolve('acme/foo', { SDLC_PROVIDERS: 'envp' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("provider 'acme' is not listed in SDLC_PROVIDERS");

    // AC39 a key variable only in .env is not used
    fs.writeFileSync(path.join(tmp, '.env'), `REG_KEY=${KEY}\n`);
    r = resolve('reg/m1', {}, tmp);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REG_KEY');
    expect(r.stdout + r.stderr).not.toContain(KEY);

    // AC38 the .env-style provider key does not rescue a registry provider
    registry({ openrouter: { ...REG.reg } });
    r = resolve('openrouter/m1', { SDLC_PROVIDERS: 'openrouter', SDLC_PROVIDER_OPENROUTER_API_KEY: 'sk-from-env' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('REG_KEY');
  });

  test('AC43 AC44 registry_check passes for a missing or valid file and fails for a corrupt one; Anthropic models never need the registry', () => {
    // AC44 no registry file and no SDLC_PROVIDER*
    let r = bash('resolve_provider opus review; echo "$PV_ACTIVE|$PV_MODEL|$PV_EFFORT_FLAG"');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0|opus|1');
    expect(bash('registry_check; echo reached').stdout.trim()).toBe('reached');

    registry(REG);
    expect(bash('registry_check; echo reached').stdout.trim()).toBe('reached');

    // AC43 a corrupt file exits 1 with its path, at startup and on resolve
    fs.writeFileSync(regFile, '{ broken');
    r = bash('registry_check; echo reached');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(regFile);
    expect(r.stdout).not.toContain('reached');
    r = resolve('reg/m1', { REG_KEY: KEY });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(regFile);

    // an Anthropic model does not consult it after startup
    r = bash('resolve_provider sonnet plan; echo "$PV_ACTIVE|$PV_MODEL"');
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

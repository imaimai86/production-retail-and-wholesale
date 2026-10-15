const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

// Settings laid out like this repository: one Jest suite in server/ with its tests in server/__tests__.
const SETTINGS = {
  suites: [{ name: 'server', dir: 'server', runner: 'jest', testCmd: 'npm test', testGlobs: ['__tests__/**'] }],
  agent: { codeSearch: 'none' },
  ui: { timezone: 'UTC' },
};

// Gives a temporary repository what scripts/sdlc.sh needs to load its settings: the real scripts/sdlc-config.cjs, an
// sdlc.config.json (SETTINGS unless given) and the suite folder.
function addSdlcSettings(dir, settings = SETTINGS) {
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/sdlc-config.cjs'), path.join(dir, 'scripts/sdlc-config.cjs'));
  for (const s of settings.suites || []) fs.mkdirSync(path.join(dir, s.dir || '.'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sdlc.config.json'), `${JSON.stringify(settings, null, 2)}\n`);
}

// The variables that steer a pipeline run (where it starts, its base branch, its worktrees...). A test that starts
// sdlc.sh or sdlc-mod.sh gets an environment without them, so a developer's shell (or a pipeline running these very
// tests) cannot change what the test runs.
const PIPELINE_CONTROLS = ['FROM', 'SDLC_BASE', 'SDLC_WT_BASE', 'SDLC_MAX_PARALLEL', 'SDLC_ALLOW_MERGED', 'SDLC_PLUGIN_DIRS',
  'WATCH_INTERVAL', 'SDLC_MODEL', 'SDLC_EFFORT', 'CI'];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of PIPELINE_CONTROLS) delete env[k];
  for (const k of Object.keys(env)) if (/^(MODEL|EFFORT)_[A-Z_]+$/.test(k)) delete env[k];
  return { ...env, ...extra };
}

module.exports = { SETTINGS, addSdlcSettings, cleanEnv, PIPELINE_CONTROLS };

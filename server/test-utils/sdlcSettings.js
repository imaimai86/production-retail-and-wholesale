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

module.exports = { SETTINGS, addSdlcSettings };

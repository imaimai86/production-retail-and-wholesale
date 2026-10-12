// Guards the CONFIG pane code itself. config-pane-docs.test.js only reads the docs, and the pane tests in
// .claude/plugins/sdlc-monitor/hooks/register.test.ts run with `claude plugin test`, not with npm test,
// so without this file the pane could disappear while npm test stays green.
const fs = require('fs');
const path = require('path');

const plugin = path.join(__dirname, '..', '..', '..', '.claude', 'plugins', 'sdlc-monitor');
const read = (rel) => fs.readFileSync(path.join(plugin, rel), 'utf8');

describe('sdlc-monitor CONFIG pane code', () => {
  const source = read('hooks/register.tsx');

  test('registers the /sdlc-config command and handles it', () => {
    expect(source).toMatch(/name: 'sdlc-config'/);
    expect(source).toMatch(/command: 'sdlc-config'/);
  });

  test('adds the CONFIG button above the prompt, beside SDLC', () => {
    expect(source).toMatch(/key="config-open" label="CONFIG"/);
    expect(source).toMatch(/key="sdlc-open" label="SDLC"/);
  });

  test('renders the pane through the wrapper only, never the registry file', () => {
    expect(source).toMatch(/requestId: CONFIG_PANE/);
    expect(source).toMatch(/\['bash', WRAPPER, 'model', \.\.\.args\]/);
    expect(source).not.toMatch(/models\.json|sdlc-models\.cjs/);
  });

  test('has the list page (Add provider, Edit) and the form page (Save, Save and add another, Cancel)', () => {
    for (const key of ['config-add-new', 'config-edit:', 'config-save"', 'config-save-another', 'config-cancel']) expect(source).toContain(key);
    for (const key of ['notice-copy', 'notice-dismiss', 'reason-copy', 'did not start', 'perm-allow:', 'perm-always:', 'perm-deny:', "'permit'", 'Files changed per stage', 'stage-files.json', 'Stopping ${run.slug}', 'Discarding ${run.slug}']) expect(source).toContain(key);
  });

  test('has the four form fields, the two-press Remove and Test', () => {
    for (const key of ['provider', 'endpoint', 'keyEnv', 'models']) expect(source).toContain(`key: '${key}'`);
    expect(source).toContain('API key variable NAME (not the key)');
    expect(source).toContain('Confirm remove');
    expect(source).toMatch(/config-test:/);
  });

  test('types declare the five config state entries', () => {
    const types = read('types/index.d.ts');
    for (const name of ['configList', 'configError', 'configForm', 'configView', 'configEditing', 'configConfirmProvider', 'configConfirmModel']) {
      expect(types).toContain(name);
    }
  });

  test('the pane tests exist in register.test.ts', () => {
    const tests = read('hooks/register.test.ts');
    expect(tests).toMatch(/CONFIG button sits beside SDLC/);
    expect(tests).toMatch(/Add provider opens the form; Save adds the provider and returns to the list/);
  });
});

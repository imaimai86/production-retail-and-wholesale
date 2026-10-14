const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

describe('integration test setup', () => {
  test('server and root package.json have a test:integration script, and the unit run ignores the integration folder', () => {
    const pkg = JSON.parse(read('server/package.json'));
    expect(pkg.scripts['test:integration']).toBeTruthy();
    expect(pkg.scripts['test:integration']).toMatch(/--runInBand/);
    expect(pkg.scripts['test:integration']).toMatch(/__tests__\/integration/);
    const ignore = (pkg.jest && pkg.jest.testPathIgnorePatterns) || [];
    expect(ignore.some(p => p.includes('/__tests__/integration/'))).toBe(true);
    expect(ignore).toContain('/node_modules/');

    const rootPkg = JSON.parse(read('package.json'));
    expect(rootPkg.scripts['test:integration']).toBe('npm run test:integration --prefix server');
    expect(rootPkg.scripts.test).toBe('npm run test --prefix server');
  });

  test('.gitlab-ci.yml runs the unit and integration jobs on node:22 with a throwaway postgres:16 service', () => {
    expect(fs.existsSync(path.join(root, '.gitlab-ci.yml'))).toBe(true);
    const ci = read('.gitlab-ci.yml');

    expect(ci).toMatch(/^unit:/m);
    expect(ci).toMatch(/^integration:/m);
    // both suites run
    expect(ci).toMatch(/npm test\b/);
    expect(ci).toMatch(/npm run test:integration/);

    // the service, with alias postgres
    expect(ci).toMatch(/postgres:16/);
    expect(ci).toMatch(/alias:\s*postgres/);

    // node:22 and a lockfile-keyed cache
    expect(ci).toMatch(/node:22/);
    expect(ci).toMatch(/package-lock\.json/);
    expect(ci).toMatch(/server\/package-lock\.json/);

    // throwaway DB variables and DATABASE_URL
    expect(ci).toMatch(/POSTGRES_DB:\s*["']?app["']?/);
    expect(ci).toMatch(/POSTGRES_USER:\s*["']?app["']?/);
    expect(ci).toMatch(/POSTGRES_PASSWORD:\s*["']?app["']?/);
    expect(ci).toMatch(/DATABASE_URL:\s*["']?postgres:\/\/app:app@postgres:5432\/app["']?/);

    // masked CI/CD variables are mentioned for real secrets
    expect(ci).toMatch(/#.*masked/i);

    // psql is not installed
    expect(ci).not.toMatch(/apt-get/);
    expect(ci).not.toMatch(/psql/);
  });

  test('docs: README has a Running integration tests section with commands; AGENTS.md and server/README.md mention them', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/Running integration tests/);
    expect(readme).toContain('docker run -d --name prw-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app -p 5432:5432 postgres:16');
    expect(readme).toContain('DATABASE_URL=postgres://app:app@localhost:5432/app npm run test:integration');

    expect(read('AGENTS.md')).toMatch(/test:integration/);
    expect(read('server/README.md')).toMatch(/Running integration tests/);
  });
});

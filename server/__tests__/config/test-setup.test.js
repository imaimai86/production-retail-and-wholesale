const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

describe('integration test setup', () => {
  test('server/package.json has test:integration script and ignore pattern', () => {
    const pkg = JSON.parse(read('server/package.json'));
    expect(pkg.scripts['test:integration']).toBeTruthy();
    expect(pkg.scripts['test:integration']).toMatch(/--runInBand/);
    expect(pkg.scripts['test:integration']).toMatch(/__tests__\/integration/);
    const ignore = (pkg.jest && pkg.jest.testPathIgnorePatterns) || [];
    expect(ignore.some(p => p.includes('/__tests__/integration/'))).toBe(true);
    expect(ignore).toContain('/node_modules/');
  });

  test('server npm test script is unchanged', () => {
    expect(JSON.parse(read('server/package.json')).scripts.test).toBe('jest');
  });

  test('root package.json has test:integration and keeps test', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['test:integration']).toBe('npm run test:integration --prefix server');
    expect(pkg.scripts.test).toBe('npm run test --prefix server');
  });

  describe('.gitlab-ci.yml', () => {
    let ci;
    beforeAll(() => {
      expect(fs.existsSync(path.join(root, '.gitlab-ci.yml'))).toBe(true);
      ci = read('.gitlab-ci.yml');
    });

    test('defines unit and integration jobs', () => {
      expect(ci).toMatch(/^unit:/m);
      expect(ci).toMatch(/^integration:/m);
    });

    test('integration job uses a postgres:16 service with alias postgres', () => {
      expect(ci).toMatch(/postgres:16/);
      expect(ci).toMatch(/alias:\s*postgres/);
    });

    test('runs both suites', () => {
      expect(ci).toMatch(/npm test\b/);
      expect(ci).toMatch(/npm run test:integration/);
    });

    test('uses node:22 and a lockfile-keyed cache', () => {
      expect(ci).toMatch(/node:22/);
      expect(ci).toMatch(/package-lock\.json/);
      expect(ci).toMatch(/server\/package-lock\.json/);
    });

    test('sets throwaway DB variables and DATABASE_URL', () => {
      expect(ci).toMatch(/POSTGRES_DB:\s*["']?app["']?/);
      expect(ci).toMatch(/POSTGRES_USER:\s*["']?app["']?/);
      expect(ci).toMatch(/POSTGRES_PASSWORD:\s*["']?app["']?/);
      expect(ci).toMatch(/DATABASE_URL:\s*["']?postgres:\/\/app:app@postgres:5432\/app["']?/);
    });

    test('mentions masked CI/CD variables for real secrets', () => {
      expect(ci).toMatch(/#.*masked/i);
    });

    test('does not install psql', () => {
      expect(ci).not.toMatch(/apt-get/);
      expect(ci).not.toMatch(/psql/);
    });
  });

  describe('docs', () => {
    test('README has Running integration tests section with commands', () => {
      const readme = read('README.md');
      expect(readme).toMatch(/Running integration tests/);
      expect(readme).toContain('docker run -d --name prw-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -e POSTGRES_DB=app -p 5432:5432 postgres:16');
      expect(readme).toContain('DATABASE_URL=postgres://app:app@localhost:5432/app npm run test:integration');
    });

    test('AGENTS.md and server/README.md mention integration tests', () => {
      expect(read('AGENTS.md')).toMatch(/test:integration/);
      expect(read('server/README.md')).toMatch(/Running integration tests/);
    });
  });
});

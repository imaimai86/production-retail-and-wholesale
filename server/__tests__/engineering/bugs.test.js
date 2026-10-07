const fs = require('fs');
const path = require('path');

const bugs = fs.readFileSync(path.join(__dirname, '../../../Engineering/bugs.md'), 'utf8');

describe('Engineering/bugs.md', () => {
  test('the POST /users docs entry is marked as fixed', () => {
    const heading = bugs.split('\n').find(l => l.startsWith('## ') && l.includes('POST /users') && l.includes('docs list fields'));
    expect(heading).toBeDefined();
    expect(heading).toMatch(/fixed/i);
  });
});

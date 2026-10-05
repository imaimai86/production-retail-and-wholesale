const fs = require('fs');
const path = require('path');

const spec = require('../../openapi-spec.json');
const apiMd = fs.readFileSync(path.join(__dirname, '../../API.md'), 'utf8');

describe('OpenAPI spec', () => {
  test('POST /sales requires location and documents 400/404/409', () => {
    const op = spec.paths['/sales'].post;
    const schema = op.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('location');
    expect(schema.properties.location).toBeDefined();
    expect(schema.properties.status).toBeDefined();
    ['400', '404', '409'].forEach(code => expect(op.responses[code]).toBeDefined());
  });

  test('POST /inventory/transfer documents 400 and 409', () => {
    const op = spec.paths['/inventory/transfer'].post;
    ['400', '409'].forEach(code => expect(op.responses[code]).toBeDefined());
  });

  test('PATCH /sales/{id}/status documents 400, 404 and 409', () => {
    const op = spec.paths['/sales/{id}/status'].patch;
    ['400', '404', '409'].forEach(code => expect(op.responses[code]).toBeDefined());
  });
});

describe('API.md', () => {
  test('documents the required location and the 409 message', () => {
    expect(apiMd).toMatch(/location/i);
    expect(apiMd).toContain('Insufficient stock');
  });
});

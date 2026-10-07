const fs = require('fs');
const path = require('path');

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerDefinition = require('../../swaggerDef');
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

describe('POST /users in the OpenAPI spec', () => {
  const op = spec.paths['/users'].post;
  const schema = op.requestBody.content['application/json'].schema;

  test('summary is "Create a new user"', () => {
    expect(op.summary).toBe('Create a new user');
  });

  test('request body documents name (string, required) only', () => {
    expect(schema.properties.name.type).toBe('string');
    expect(schema.required).toContain('name');
    expect(Object.keys(schema.properties)).toEqual(['name']);
    ['username', 'password', 'role'].forEach(f => expect(schema.properties[f]).toBeUndefined());
  });

  test('responses are exactly 201, 400, 401, 403, 500', () => {
    expect(Object.keys(op.responses).sort()).toEqual(['201', '400', '401', '403', '500']);
  });

  test('committed spec equals freshly generated output', () => {
    const generated = swaggerJsdoc({
      ...swaggerDefinition,
      apis: swaggerDefinition.apis.map(a => path.resolve(__dirname, '../..', a))
    });
    expect(spec).toEqual(JSON.parse(JSON.stringify(generated)));
  });
});

describe('API.md', () => {
  test('POST /users line documents name, the 400 messages and ignored fields', () => {
    const line = apiMd.split('\n').find(l => l.includes('POST /users'));
    expect(line).toBeDefined();
    expect(line).toContain('name is required');
    expect(line).toContain('name must be a string');
    expect(line).toMatch(/ignored/i);
  });

  test('documents the required location and the 409 message', () => {
    expect(apiMd).toMatch(/location/i);
    expect(apiMd).toContain('Insufficient stock');
  });
});

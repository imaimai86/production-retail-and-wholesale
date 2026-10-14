const fs = require('fs');
const path = require('path');

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerDefinition = require('../../swaggerDef');
const spec = require('../../openapi-spec.json');
const apiMd = fs.readFileSync(path.join(__dirname, '../../API.md'), 'utf8');

describe('OpenAPI spec', () => {
  test('sales and inventory operations document their error responses, and POST /sales requires location', () => {
    const sale = spec.paths['/sales'].post;
    const schema = sale.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('location');
    expect(schema.properties.location).toBeDefined();
    expect(schema.properties.status).toBeDefined();
    ['400', '404', '409'].forEach(code => expect(sale.responses[code]).toBeDefined());

    const transfer = spec.paths['/inventory/transfer'].post;
    ['400', '409'].forEach(code => expect(transfer.responses[code]).toBeDefined());

    const status = spec.paths['/sales/{id}/status'].patch;
    ['400', '404', '409'].forEach(code => expect(status.responses[code]).toBeDefined());
  });

  test('POST /users documents name (string, required) only, with responses 201, 400, 401, 403 and 500', () => {
    const op = spec.paths['/users'].post;
    const schema = op.requestBody.content['application/json'].schema;
    expect(op.summary).toBe('Create a new user');

    expect(schema.properties.name.type).toBe('string');
    expect(schema.required).toContain('name');
    expect(Object.keys(schema.properties)).toEqual(['name']);
    ['username', 'password', 'role'].forEach(f => expect(schema.properties[f]).toBeUndefined());

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
  test('documents POST /users (name, the 400 messages, ignored fields), the required location and the 409 message', () => {
    const line = apiMd.split('\n').find(l => l.includes('POST /users'));
    expect(line).toBeDefined();
    expect(line).toContain('name is required');
    expect(line).toContain('name must be a string');
    expect(line).toMatch(/ignored/i);

    expect(apiMd).toMatch(/location/i);
    expect(apiMd).toContain('Insufficient stock');
  });
});

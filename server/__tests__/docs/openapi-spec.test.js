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

describe('OpenAPI spec for /users', () => {
  const postOp = spec.paths['/users'].post;
  const postSchema = postOp.requestBody.content['application/json'].schema;

  test('POST /users request body has only a required string name', () => {
    expect(postSchema.properties.name.type).toBe('string');
    expect(postSchema.required).toContain('name');
    ['username', 'password', 'role'].forEach(f => expect(postSchema.properties[f]).toBeUndefined());
  });

  test('POST /users documents 201 and 400 and has a clean summary', () => {
    ['201', '400'].forEach(code => expect(postOp.responses[code]).toBeDefined());
    expect(postOp.summary).not.toMatch(/Test update/i);
    expect(postOp.summary).toBe('Create a new user');
  });

  test('POST /users 201 schema has id integer and name string', () => {
    const props = postOp.responses['201'].content['application/json'].schema.properties;
    expect(props.id.type).toBe('integer');
    expect(props.name.type).toBe('string');
  });

  test('GET /users 200 item schema has exactly id and name', () => {
    const items = spec.paths['/users'].get.responses['200'].content['application/json'].schema.items;
    expect(Object.keys(items.properties).sort()).toEqual(['id', 'name']);
  });

  test('committed spec equals a fresh generation from the JSDoc comments', () => {
    const fresh = swaggerJsdoc({ ...swaggerDefinition });
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(spec);
  });
});

describe('API.md', () => {
  test('documents the POST /users name field and 400 messages', () => {
    expect(apiMd).toContain('name is required');
    expect(apiMd).toContain('name must be a string');
  });

  test('documents the required location and the 409 message', () => {
    expect(apiMd).toMatch(/location/i);
    expect(apiMd).toContain('Insufficient stock');
  });
});

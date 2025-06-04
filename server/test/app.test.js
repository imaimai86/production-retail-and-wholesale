const request = require('supertest');
const app = require('../index');

describe('GET /', () => {
  it('responds with status ok', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

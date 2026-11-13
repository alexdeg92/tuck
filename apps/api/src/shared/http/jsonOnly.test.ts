import { ApiError } from '@todo/contracts';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeErrorHandler } from './errors';
import { jsonOnly } from './jsonOnly';

const app = express()
  .use(jsonOnly)
  .use(express.json())
  .all('/echo', (req, res) => {
    res.json({ body: req.body as unknown });
  })
  .use(makeErrorHandler(() => undefined));

describe('jsonOnly', () => {
  it('lets JSON bodies through', async () => {
    const response = await request(app).post('/echo').send({ a: 1 });
    expect(response.body).toEqual({ body: { a: 1 } });
  });

  it('lets a bodiless POST through (logout)', async () => {
    expect((await request(app).post('/echo')).status).toBe(200);
  });

  it.each([
    ['text/plain', 'a=1'],
    ['application/x-www-form-urlencoded', 'a=1'],
    ['application/x-www-form-urlencoded', ''],
  ])('rejects a %s body with 400 VALIDATION_FAILED', async (type, body) => {
    const response = await request(app).post('/echo').set('Content-Type', type).send(body);

    expect(response.status).toBe(400);
    expect(ApiError.parse(response.body).error.code).toBe('VALIDATION_FAILED');
  });

  it.each(['application/json', 'application/json; charset=utf-8'])(
    'lets an empty body labelled %s through (a DELETE from a generic client)',
    async (type) => {
      const response = await request(app).delete('/echo').set('Content-Type', type);
      expect(response.status).toBe(200);
    },
  );

  it('still rejects a non-JSON body sent without any Content-Type', async () => {
    const response = await request(app)
      .post('/echo')
      .set('Content-Length', '3')
      .unset('Content-Type')
      .send('a=1');
    expect(response.status).toBe(400);
  });

  it('ignores reads', async () => {
    expect((await request(app).get('/echo').set('Content-Type', 'text/plain')).status).toBe(200);
  });
});

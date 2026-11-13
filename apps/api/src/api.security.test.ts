import { ApiError } from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { makeTestApp, signedIn } from './testing';

const errorOf = (response: request.Response) => ApiError.parse(response.body).error;

describe('HTTP hardening', () => {
  it('keeps HSTS by default and disables it only for explicit insecure HTTP', async () => {
    const secure = await request(makeTestApp({ cookieSecure: true }).app).get('/api/health');
    expect(secure.headers['strict-transport-security']).toContain('max-age=');
    const local = await request(makeTestApp({ cookieSecure: false, hsts: false }).app).get(
      '/api/health',
    );
    expect(local.headers['strict-transport-security']).toBeUndefined();
    expect(local.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sends helmet security headers and hides the framework', async () => {
    const { app } = makeTestApp();
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a form-encoded write with 400 before it reaches a route', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const response = await agent
      .post('/api/tasks')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('title=csrf');

    expect(response.status).toBe(400);
    expect(errorOf(response)).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Request body must be application/json',
    });
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = makeTestApp();
    const response = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(errorOf(response).message).toBe('Malformed JSON body');
  });

  it('rejects a body over 16 kB with 400 before hashing anything', async () => {
    const { app, deps } = makeTestApp();
    const hash = vi.spyOn(deps.hasher, 'hash');
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'demo@example.com', password: 'x'.repeat(17_000) });

    expect(response.status).toBe(400);
    expect(errorOf(response).message).toBe('Request body too large');
    expect(hash).not.toHaveBeenCalled();
  });

  it('answers an unexpected failure with a generic 500 and logs it server-side only', async () => {
    const failure = new Error('SQLITE_ERROR: no such table: tasks; hash scrypt$16384$...');
    const { app, deps } = makeTestApp();
    deps.tasks.list = () => Promise.reject(failure);
    const agent = await signedIn(app);

    const response = await agent.get('/api/tasks');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(JSON.stringify(response.body)).not.toMatch(/SQLITE|scrypt|at /);
    expect(deps.logError).toHaveBeenCalledWith(failure);
  });

  it('never sends an error body that breaks the ApiError contract', async () => {
    const malformed = Object.assign(new Error('adapter failure'), {
      code: 'NOT_FOUND',
      details: [{ path: 7, message: 'bad' }],
    });
    const { app, deps } = makeTestApp();
    deps.tasks.list = () => Promise.reject(malformed);
    const agent = await signedIn(app);

    const response = await agent.get('/api/tasks');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(deps.logError).toHaveBeenCalledWith(malformed);
  });

  it('answers an unknown API route with a JSON 404', async () => {
    const { app } = makeTestApp();
    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('NOT_FOUND');
  });
});

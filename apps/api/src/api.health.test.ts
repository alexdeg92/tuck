import { Health } from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { version as buildVersion } from '../../../package.json';
import { loadConfig } from './shared/config';
import { makeTestApp } from './testing';

describe('GET /api/health', () => {
  it.each([
    ['without APP_VERSION, the build version', {}, buildVersion],
    ['with APP_VERSION, the release version', { APP_VERSION: '2026.11.11.2' }, '2026.11.11.2'],
  ])('reports %s', async (_label, env, expected) => {
    const { app } = makeTestApp({ version: loadConfig(env).version });
    const response = await request(app).get('/api/health');

    expect(Health.parse(response.body).version).toBe(expected);
  });

  it('reports ok and the app version', async () => {
    const { app } = makeTestApp({ version: '1.2.3' });
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(Health.parse(response.body)).toEqual({ status: 'ok', version: '1.2.3' });
  });
});

import { randomInt } from 'node:crypto';
import { endpoints } from '@todo/contracts';
import { createClient } from 'redis';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../testing';
import { openRedisRateLimitStores, type RedisRateLimitStores } from './redisRateLimitStore';

const redisUrl = (): string => {
  const url = process.env['TEST_REDIS_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_REDIS_URL is not set: run the integration suites with `npm run test:pg`.',
    );
  }
  return url;
};

const opened: RedisRateLimitStores[] = [];
afterEach(async () => {
  for (const stores of opened.splice(0)) await stores.close();
});

const open = async () => {
  const stores = await openRedisRateLimitStores(redisUrl(), { logError: vi.fn() });
  opened.push(stores);
  return stores;
};

const readKey = async (key: string) => {
  const client = await createClient({ url: redisUrl() }).connect();
  try {
    return await client.get(key);
  } finally {
    await client.close();
  }
};

describe('Redis rate-limit stores', () => {
  it('share one sign-in quota between two API instances, counted under rl:auth:<client>', async () => {
    const limit = { windowMs: 60_000, limit: 2 };
    const instance = async () =>
      makeTestApp({ trustProxy: 1, authRateLimit: limit, rateLimitStore: (await open()).store })
        .app;
    const [one, two] = [await instance(), await instance()];
    const client = `198.51.${String(randomInt(0, 256))}.${String(randomInt(1, 255))}`;
    const attempt = (app: typeof one) =>
      request(app)
        .post(endpoints.logIn.path)
        .set('X-Forwarded-For', client)
        .send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect((await attempt(one)).status).toBe(401);
    expect((await attempt(two)).status).toBe(401);
    expect((await attempt(one)).status).toBe(429);
    expect(await readKey(`rl:auth:${client}`)).toBe('3');
  });

  it('closes its connection on shutdown', async () => {
    const stores = await openRedisRateLimitStores(redisUrl(), { logError: vi.fn() });

    await expect(stores.close()).resolves.toBeUndefined();
  });
});

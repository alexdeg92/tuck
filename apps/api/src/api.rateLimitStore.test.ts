import { endpoints } from '@todo/contracts';
import type { Store } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { RateLimitStoreFactory } from './shared/http/rateLimit';
import { makeTestApp, signedIn } from './testing';

/** Stands in for Redis: one counter table that several app instances (replicas) share. */
const sharedCounters = () => {
  const counts = new Map<string, number>();
  const hits: string[] = [];
  const limiters: string[] = [];
  const factory: RateLimitStoreFactory = (limiter) => {
    limiters.push(limiter);
    const at = (key: string) => `${limiter}:${key}`;
    const store: Store = {
      increment: (key) => {
        hits.push(at(key));
        const totalHits = (counts.get(at(key)) ?? 0) + 1;
        counts.set(at(key), totalHits);
        return { totalHits, resetTime: new Date(Date.now() + 60_000) };
      },
      decrement: (key) => {
        counts.set(at(key), (counts.get(at(key)) ?? 1) - 1);
      },
      resetKey: (key) => {
        counts.delete(at(key));
      },
    };
    return store;
  };
  return { factory, hits, limiters };
};

const credentials = { email: 'nobody@example.com', password: 'wrong-password' };

describe('rate limits with a shared store', () => {
  it('asks for a separate store per limiter', () => {
    const { factory, limiters } = sharedCounters();
    makeTestApp({ rateLimitStore: factory });

    expect(limiters.toSorted()).toEqual(['auth', 'search']);
  });

  it('counts sign-in attempts in the store, so two instances share one quota', async () => {
    const { factory, hits } = sharedCounters();
    const limit = { windowMs: 60_000, limit: 2 };
    const one = makeTestApp({ rateLimitStore: factory, authRateLimit: limit }).app;
    const two = makeTestApp({ rateLimitStore: factory, authRateLimit: limit }).app;
    const attempt = (app: typeof one) => request(app).post(endpoints.logIn.path).send(credentials);

    expect((await attempt(one)).status).toBe(401);
    expect((await attempt(two)).status).toBe(401);
    expect((await attempt(one)).status).toBe(429);
    expect((await attempt(two)).status).toBe(429);
    expect(hits.every((key) => key.startsWith('auth:'))).toBe(true);
    expect(hits).toHaveLength(4);
  });

  it('counts searches per user in the search store', async () => {
    const { factory, hits } = sharedCounters();
    const { app } = makeTestApp({ rateLimitStore: factory });
    const agent = await signedIn(app);
    const me = await agent.get(endpoints.me.path).expect(200);

    await agent.get(endpoints.search.path).query({ q: 'milk' }).expect(200);

    expect(hits.filter((key) => key.startsWith('search:'))).toEqual([
      `search:${(me.body as { id: string }).id}`,
    ]);
  });
});

import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { openRedisRateLimitStores } from './redisRateLimitStore';

/** A localhost port with nothing listening on it. */
const closedPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
};

describe('openRedisRateLimitStores', () => {
  it('fails fast, without logging every retry, when REDIS_URL is set but unreachable', async () => {
    const logError = vi.fn();
    const url = `redis://127.0.0.1:${String(await closedPort())}`;
    const started = Date.now();

    await expect(openRedisRateLimitStores(url, { logError })).rejects.toThrow(
      /Redis at REDIS_URL is unreachable/,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    expect(logError).not.toHaveBeenCalled();
  });
});

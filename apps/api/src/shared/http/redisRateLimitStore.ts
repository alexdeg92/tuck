import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import type { RateLimitStoreFactory } from './rateLimit';

export type RedisRateLimitStores = {
  /** One RedisStore per limiter, its keys prefixed `rl:<limiter>:`. */
  store: RateLimitStoreFactory;
  close: () => Promise<void>;
};

/** Connection attempts before startup gives up: a set but unreachable REDIS_URL stops the boot. */
const STARTUP_ATTEMPTS = 5;

/**
 * Connects to Redis before the app is built, so the limiters share one counter per client across
 * every API instance. Startup fails fast when Redis is unreachable; once connected, a dropped
 * connection is retried with a capped backoff (meanwhile limited routes answer 500, never unlimited).
 */
export const openRedisRateLimitStores = async (
  url: string,
  {
    logError,
    connectTimeoutMs = 2000,
  }: { logError: (error: unknown) => void; connectTimeoutMs?: number },
): Promise<RedisRateLimitStores> => {
  let connected = false;
  const client = createClient({
    url,
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: (retries, cause) =>
        !connected && retries >= STARTUP_ATTEMPTS - 1
          ? new Error(`Redis at REDIS_URL is unreachable: ${cause.message}`)
          : Math.min(100 * 2 ** retries, 3000),
    },
  });
  client.on('error', (error: unknown) => {
    if (connected) logError(error);
  });

  await client.connect();
  connected = true;

  return {
    store: (limiter) =>
      new RedisStore({
        prefix: `rl:${limiter}:`,
        sendCommand: (...args: string[]) => client.sendCommand(args),
      }),
    close: async () => {
      connected = false;
      await client.close();
    },
  };
};

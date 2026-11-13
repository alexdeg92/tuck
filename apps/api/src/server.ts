import { randomUUID } from 'node:crypto';
import { buildApp } from './app';
import { makePurgeTrash } from './modules/tasks/application';
import { makeJoseTokens } from './modules/auth/infrastructure/joseTokens';
import { makeScryptHasher } from './modules/auth/infrastructure/scryptHasher';
import { keyBetween } from './modules/tasks/domain/ordering';
import { seedDemo } from './seed';
import { loadConfig } from './shared/config';
import { openRedisRateLimitStores } from './shared/http/redisRateLimitStore';
import { openStorage } from './storage';

const log = (message: string) => process.stdout.write(`${message}\n`);
const logError = (error: unknown) =>
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );

const config = loadConfig(process.env);
// REDIS_URL set: every instance counts rate limits in Redis (fails fast if unreachable); else in memory.
const rateLimitStores =
  config.redisUrl === undefined
    ? undefined
    : await openRedisRateLimitStores(config.redisUrl, { logError });
// DATABASE_URL set: Postgres; otherwise the SQLite file. Both are migrated on open.
const storage = await openStorage(config);

const clock = () => new Date();
const deps = {
  users: storage.users,
  tasks: storage.tasks,
  checklists: storage.checklists,
  hasher: makeScryptHasher(),
  tokens: makeJoseTokens({ secret: config.jwtSecret, clock }),
  clock,
  ids: randomUUID,
  keyBetween,
};

if (config.seedDemo) {
  const { created, added } = await seedDemo({ ...deps, demo: storage.demo }, clock());
  if (created) log('Created the demo account demo@example.com');
  if (added > 0) log(`Added ${String(added)} demo tasks to demo@example.com`);
}

const purgeTrash = makePurgeTrash(deps);
const purge = () =>
  purgeTrash().then((purged) => {
    if (purged > 0) log(`Purged ${String(purged)} task(s) from the trash`);
  }, logError);
await purge();
setInterval(() => void purge(), 60 * 60 * 1000).unref();

const app = buildApp({
  ...deps,
  version: config.version,
  cookieSecure: config.cookieSecure,
  ...(process.env.COOKIE_SECURE === 'false' && { hsts: false as const }),
  trustProxy: config.trustProxy,
  authRateLimit: { windowMs: 15 * 60 * 1000, limit: 20 },
  searchRateLimit: { windowMs: 60 * 1000, limit: 60 },
  ...(rateLimitStores && { rateLimitStore: rateLimitStores.store }),
  logError,
});

const server = app.listen(config.port, (error) => {
  if (error) throw error;
  log(
    `API ${config.version} listening on http://localhost:${String(config.port)} (${config.nodeEnv}, ${storage.engine}, ${rateLimitStores ? 'redis' : 'in-memory'} rate limits)`,
  );
});

const shutdown = (signal: NodeJS.Signals) => {
  log(`${signal} received, shutting down`);
  server.close(() => {
    void Promise.all([storage.close(), rateLimitStores?.close()]).then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { version as buildVersion } from '../../../../package.json';
import { DEV_JWT_SECRET, loadConfig } from './config';

const strongSecret = 'a'.repeat(64);

describe('loadConfig', () => {
  it('applies development defaults when the environment is empty', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      nodeEnv: 'development',
      jwtSecret: DEV_JWT_SECRET,
      databaseFile: './data/todo.db',
      databaseUrl: undefined,
      redisUrl: undefined,
      seedDemo: true,
      cookieSecure: false,
      trustProxy: 0,
      version: buildVersion,
    });
  });

  it('uses the same dev secret as .env.example', () => {
    const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
    expect(example).toContain(`JWT_SECRET=${DEV_JWT_SECRET}\n`);
  });

  it('parses the variables the e2e launcher sets', () => {
    expect(
      loadConfig({
        NODE_ENV: 'test',
        PORT: '4310',
        DATABASE_FILE: '/tmp/x/e2e.db',
        JWT_SECRET: strongSecret,
        SEED_DEMO: 'true',
        COOKIE_SECURE: 'false',
        TRUST_PROXY: '1',
      }),
    ).toEqual({
      port: 4310,
      nodeEnv: 'test',
      jwtSecret: strongSecret,
      databaseFile: '/tmp/x/e2e.db',
      databaseUrl: undefined,
      redisUrl: undefined,
      seedDemo: true,
      cookieSecure: false,
      trustProxy: 1,
      version: buildVersion,
    });
  });

  it('defaults to secure cookies and no demo seed in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: strongSecret })).toMatchObject({
      seedDemo: false,
      cookieSecure: true,
    });
  });

  it('does not seed the demo user outside development by default', () => {
    expect(loadConfig({ NODE_ENV: 'test', JWT_SECRET: strongSecret }).seedDemo).toBe(false);
  });

  it.each([
    ['missing', {}],
    ['shorter than 32 characters', { JWT_SECRET: 'x'.repeat(31) }],
    ['the published dev placeholder', { JWT_SECRET: DEV_JWT_SECRET }],
  ])('refuses to boot in production with a secret %s', (_label, env) => {
    expect(() => loadConfig({ NODE_ENV: 'production', ...env })).toThrow(/JWT_SECRET/);
  });

  it('rejects a short secret in any environment', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('serves the build-time package.json version when APP_VERSION is unset', () => {
    expect(loadConfig({}).version).toBe(buildVersion);
  });

  it.each(['2026.11.11', '2026.11.11.2'])('serves APP_VERSION=%s when it is set', (APP_VERSION) => {
    expect(loadConfig({ APP_VERSION }).version).toBe(APP_VERSION);
  });

  it.each(['postgres://todo:secret@db:5432/todo', 'postgresql://localhost/todo'])(
    'selects Postgres with DATABASE_URL=%s',
    (DATABASE_URL) => {
      expect(loadConfig({ DATABASE_URL }).databaseUrl).toBe(DATABASE_URL);
    },
  );

  it.each(['redis://redis:6379', 'rediss://user:secret@cache.example.com:6380/0'])(
    'shares the rate limits through Redis with REDIS_URL=%s',
    (REDIS_URL) => {
      expect(loadConfig({ REDIS_URL }).redisUrl).toBe(REDIS_URL);
    },
  );

  it.each([
    ['DATABASE_URL', 'mysql://localhost/todo'],
    ['REDIS_URL', 'http://redis:6379'],
    ['REDIS_URL', ''],
    ['DATABASE_URL', ''],
    ['APP_VERSION', ''],
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['SEED_DEMO', 'yes'],
    ['COOKIE_SECURE', '1'],
    ['TRUST_PROXY', '-1'],
    ['NODE_ENV', 'staging'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow();
  });
});

import { z } from 'zod';
// Inlined at build time by tsup (only the version string lands in the bundle); tsx reads it in dev.
import { version as buildVersion } from '../../../../package.json';

/** The published placeholder from .env.example: fine for local dev, refused in production. */
export const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-change-me';

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const Env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
    DATABASE_FILE: z.string().min(1).default('./data/todo.db'),
    /** Set: Postgres (e.g. postgres://user:pass@host:5432/todo). Unset: the SQLite file above. */
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL')
      .optional(),
    /** Set: rate limits are counted in Redis, shared by every API instance. Unset: in memory. */
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// or rediss:// URL')
      .optional(),
    SEED_DEMO: flag.optional(),
    COOKIE_SECURE: flag.optional(),
    /** Number of reverse proxies in front of the API (0 = connect directly). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Version served by /api/health (e.g. 1.2.0); defaults to package.json. */
    APP_VERSION: z.string().min(1).optional(),
  })
  .refine(
    ({ NODE_ENV, JWT_SECRET }) =>
      NODE_ENV !== 'production' || (JWT_SECRET !== undefined && JWT_SECRET !== DEV_JWT_SECRET),
    { message: 'JWT_SECRET must be set to a real secret in production', path: ['JWT_SECRET'] },
  );

export type Config = {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  jwtSecret: string;
  databaseFile: string;
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  seedDemo: boolean;
  cookieSecure: boolean;
  trustProxy: number;
  /** Served by /api/health: APP_VERSION when set, else package.json's version. */
  version: string;
};

/** Parses the process environment once at startup; an invalid value stops the boot. */
export const loadConfig = (env: NodeJS.ProcessEnv): Config => {
  const parsed = Env.parse(env);
  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    jwtSecret: parsed.JWT_SECRET ?? DEV_JWT_SECRET,
    databaseFile: parsed.DATABASE_FILE,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    seedDemo: parsed.SEED_DEMO ?? parsed.NODE_ENV === 'development',
    cookieSecure: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === 'production',
    trustProxy: parsed.TRUST_PROXY,
    version: parsed.APP_VERSION ?? buildVersion,
  };
};

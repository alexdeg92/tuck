import { endpoints } from '@todo/contracts';
import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { type AppDeps, buildApp } from './app';
import { makeJoseTokens } from './modules/auth/infrastructure/joseTokens';
import { makeScryptHasher, SCRYPT_PARAMS } from './modules/auth/infrastructure/scryptHasher';
import { makeSqliteUserRepository } from './modules/auth/infrastructure/sqliteUserRepository';
import { keyBetween } from './modules/tasks/domain/ordering';
import { makeSqliteChecklistRepository } from './modules/checklists/infrastructure/sqliteChecklistRepository';
import { makeSqliteTaskRepository } from './modules/tasks/infrastructure/sqliteTaskRepository';
import { type Db, openDatabase } from './shared/db/connection';
import { runMigrations } from './shared/db/migrate';

export const PASSWORD = 'demo1234';

export type TestApp = { app: Express; deps: AppDeps; db: Db; time: { now: Date } };
export type Agent = ReturnType<typeof request.agent>;

export const makeTestApp = (overrides: Partial<AppDeps> = {}): TestApp => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const time = { now: new Date('2026-11-11T09:30:00.000Z') };
  const clock = () => time.now;
  const deps: AppDeps = {
    version: '1.0.0',
    users: makeSqliteUserRepository(db),
    tasks: makeSqliteTaskRepository(db),
    checklists: makeSqliteChecklistRepository(db),
    hasher: makeScryptHasher({ ...SCRYPT_PARAMS, N: 1024 }),
    tokens: makeJoseTokens({ secret: 'test-secret-'.padEnd(32, 'x'), clock }),
    clock,
    ids: () => crypto.randomUUID(),
    keyBetween,
    cookieSecure: false,
    trustProxy: 0,
    authRateLimit: { windowMs: 60_000, limit: 1000 },
    searchRateLimit: { windowMs: 60_000, limit: 1000 },
    logError: vi.fn(),
    ...overrides,
  };
  return { app: buildApp(deps), deps, db, time };
};

export const signedIn = async (app: Express, email = 'demo@example.com'): Promise<Agent> => {
  const agent = request.agent(app);
  await agent
    .post(endpoints.signUp.path)
    .send({ email, password: PASSWORD, confirmPassword: PASSWORD })
    .expect(201);
  return agent;
};

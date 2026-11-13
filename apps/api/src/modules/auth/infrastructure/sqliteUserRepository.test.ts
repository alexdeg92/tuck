import { afterEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from '../../../shared/db/connection';
import { runMigrations } from '../../../shared/db/migrate';
import { describeUserRepository } from '../application/userRepository.contract';
import { makeSqliteUserRepository } from './sqliteUserRepository';

const open: Db[] = [];
afterEach(() => {
  open.splice(0).forEach((db) => db.close());
});

const migratedDb = (): Db => {
  const db = openDatabase(':memory:');
  open.push(db);
  runMigrations(db);
  return db;
};

describeUserRepository('sqlite', async () => makeSqliteUserRepository(migratedDb()));

describe('sqlite user repository row parsing', () => {
  const VALID = {
    id: '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d',
    email: 'demo@example.com',
    password_hash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    created_at: '2026-11-11T09:30:00.000Z',
  };

  it.each([
    ['an id that is not a UUID', { id: 'not-a-uuid' }],
    ['a created_at that is not an instant', { created_at: 'not-an-instant' }],
    ['an empty password hash', { password_hash: '' }],
  ])('refuses a stored row with %s', async (_label, corruption) => {
    const db = migratedDb();
    const row = { ...VALID, ...corruption };
    db.prepare(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (@id, @email, @password_hash, @created_at)',
    ).run(row);
    const users = makeSqliteUserRepository(db);

    await expect(users.findByEmail(row.email)).rejects.toThrow();
    await expect(users.findById(row.id)).rejects.toThrow();
  });
});

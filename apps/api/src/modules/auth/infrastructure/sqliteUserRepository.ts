import type { Db } from '../../../shared/db/connection';
import { conflict } from '../../../shared/errors';
import type { UserRepository } from '../application/ports';
import { UserAccount } from '../domain/user';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  session_version: number;
};

const toAccount = (row: UserRow): UserAccount =>
  UserAccount.parse({
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    sessionVersion: row.session_version,
  });

export const makeSqliteUserRepository = (db: Db): UserRepository => {
  const insert = db.prepare<UserAccount>(
    'INSERT INTO users (id, email, password_hash, created_at, session_version) VALUES (@id, @email, @passwordHash, @createdAt, @sessionVersion)',
  );
  const bump = db.prepare<[string], { session_version: number }>(
    'UPDATE users SET session_version = session_version + 1 WHERE id = ? RETURNING session_version',
  );
  const byEmail = db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?');
  const byId = db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?');

  return {
    insert: async (account) => {
      try {
        insert.run(account);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('UNIQUE constraint failed: users.email')
        ) {
          throw conflict('Email already registered');
        }
        throw error;
      }
    },
    findByEmail: async (email) => {
      const row = byEmail.get(email);
      return row && toAccount(row);
    },
    findById: async (id) => {
      const row = byId.get(id);
      return row && toAccount(row);
    },
    bumpSessionVersion: async (id) => bump.get(id)?.session_version,
  };
};

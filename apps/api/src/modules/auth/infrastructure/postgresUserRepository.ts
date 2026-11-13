import type pg from 'pg';
import { isUniqueViolation } from '../../../shared/db/postgres';
import { conflict } from '../../../shared/errors';
import type { UserRepository } from '../application/ports';
import { UserAccount } from '../domain/user';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  session_version: number;
};

const toAccount = (row: UserRow): UserAccount =>
  UserAccount.parse({
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
    sessionVersion: row.session_version,
  });

const optionalAccount = (row: UserRow | undefined): UserAccount | undefined =>
  row === undefined ? undefined : toAccount(row);

export const makePostgresUserRepository = (pool: pg.Pool): UserRepository => ({
  insert: async (account) => {
    try {
      await pool.query(
        'INSERT INTO users (id, email, password_hash, created_at, session_version) VALUES ($1, $2, $3, $4, $5)',
        [
          account.id,
          account.email,
          account.passwordHash,
          account.createdAt,
          account.sessionVersion,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_unique'))
        throw conflict('Email already registered');
      throw error;
    }
  },
  findByEmail: async (email) =>
    optionalAccount(
      (await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email])).rows[0],
    ),
  findById: async (id) =>
    optionalAccount((await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])).rows[0]),
  // One statement, so two concurrent bumps both count.
  bumpSessionVersion: async (id) =>
    (
      await pool.query<{ session_version: number }>(
        'UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING session_version',
        [id],
      )
    ).rows[0]?.session_version,
});

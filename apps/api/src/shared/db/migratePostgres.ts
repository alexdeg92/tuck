import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { listMigrations, readMigration } from './migrationFiles';
import { lockForTransaction, withTransaction } from './postgres';

export const POSTGRES_MIGRATIONS_DIR = fileURLToPath(
  new URL('./migrations/postgres/', import.meta.url),
);

export const runPostgresMigrations = async (
  pool: pg.Pool,
  dir: string = POSTGRES_MIGRATIONS_DIR,
): Promise<string[]> =>
  withTransaction(pool, async (client) => {
    await lockForTransaction(client, 'schema_migrations');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(done.rows.map(({ version }) => version));
    const pending = listMigrations(dir).filter(({ version }) => !applied.has(version));
    for (const migration of pending) {
      await client.query(readMigration(dir, migration));
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
    }
    return pending.map(({ name }) => name);
  });

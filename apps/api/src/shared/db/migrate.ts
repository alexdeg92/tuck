import { fileURLToPath } from 'node:url';
import type { Db } from './connection';
import { listMigrations, type Migration, readMigration } from './migrationFiles';

/**
 * The marker of a SQLite migration that must run with foreign keys off: its first line that isn't
 * blank (a byte-order mark and blank lines before it are fine).
 */
const FOREIGN_KEYS_OFF = /^\uFEFF?(?:[ \t]*\r?\n)*-- migrate: foreign-keys-off[ \t]*(?:\r?\n|$)/;

export const runsWithKeysOff = (sql: string): boolean => FOREIGN_KEYS_OFF.test(sql);

export const dropsTable = (sql: string): boolean =>
  /\bDROP\s+TABLE\b/i.test(sql.replace(/--[^\n]*/g, ''));

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/sqlite/', import.meta.url));

export const runMigrations = (db: Db, dir: string = MIGRATIONS_DIR): string[] => {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set(
    db
      .prepare<[], { version: number }>('SELECT version FROM schema_migrations')
      .all()
      .map(({ version }) => version),
  );
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const apply = db.transaction((migration: Migration, sql: string, checkKeys: boolean) => {
    db.exec(sql);
    const broken = checkKeys
      ? db
          .prepare<[], { table: string; rowid: number; parent: string }>('PRAGMA foreign_key_check')
          .all()
      : [];
    const [first] = broken;
    if (first !== undefined) {
      throw new Error(
        `Migration ${migration.name} leaves rows with a broken foreign key: ${first.table} rowid ${String(first.rowid)} -> ${first.parent}${broken.length > 1 ? ` (and ${String(broken.length - 1)} more)` : ''}`,
      );
    }
    record.run(migration.version, migration.name, new Date().toISOString());
  });

  const pending = listMigrations(dir).filter(({ version }) => !applied.has(version));
  pending.forEach((migration) => {
    const sql = readMigration(dir, migration);
    // Rebuilding a table (SQLite can't change a CHECK in place) drops the old one: with foreign

    const keysOff = runsWithKeysOff(sql);

    if (dropsTable(sql) && !keysOff) {
      throw new Error(
        `Migration ${migration.name} drops a table but does not start with "-- migrate: foreign-keys-off": with foreign keys on, the drop would delete the rows that reference it`,
      );
    }
    if (keysOff) db.pragma('foreign_keys = OFF');
    try {
      apply(migration, sql, keysOff);
    } finally {
      if (keysOff) db.pragma('foreign_keys = ON');
    }
  });
  return pending.map(({ name }) => name);
};

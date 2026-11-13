import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migrate';
import { POSTGRES_MIGRATIONS_DIR } from './migratePostgres';
import { listMigrations } from './migrationFiles';

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const dirWith = (names: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-migration-names-'));
  tempDirs.push(dir);
  names.forEach((name) => {
    writeFileSync(join(dir, name), 'SELECT 1;');
  });
  return dir;
};

describe('migration numbering (two branches must never share or skip a number)', () => {
  it('refuses two migrations with the same number, naming both', () => {
    expect(() => listMigrations(dirWith(['001_a.sql', '002_trash.sql', '002_demo.sql']))).toThrow(
      /002_demo\.sql.*002_trash\.sql|002_trash\.sql.*002_demo\.sql/,
    );
  });

  it('refuses a gap in the numbers', () => {
    expect(() => listMigrations(dirWith(['001_a.sql', '003_c.sql']))).toThrow(/002/);
    expect(() => listMigrations(dirWith(['002_b.sql']))).toThrow(/001/);
  });

  it('accepts 001..n in order', () => {
    expect(listMigrations(dirWith(['002_b.sql', '001_a.sql'])).map(({ name }) => name)).toEqual([
      '001_a.sql',
      '002_b.sql',
    ]);
  });

  it('ships the same migrations for SQLite and Postgres', () => {
    const names = (dir: string) => listMigrations(dir).map(({ name }) => name);
    expect(names(POSTGRES_MIGRATIONS_DIR)).toEqual(names(MIGRATIONS_DIR));
  });
});

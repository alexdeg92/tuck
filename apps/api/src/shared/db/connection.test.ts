import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './connection';

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('openDatabase', () => {
  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('creates the parent directory of a file database and uses WAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'todo-db-'));
    tempDirs.push(dir);

    const db = openDatabase(join(dir, 'nested', 'todo.db'));

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    db.close();
  });
});

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, openDatabase } from './connection';
import { FIRST_SEED_KEYS } from '../../demoContent';
import { dropsTable, MIGRATIONS_DIR, runMigrations, runsWithKeysOff } from './migrate';
import { listMigrations, readMigration } from './migrationFiles';

let db: Db;
const tempDirs: string[] = [];

beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => {
  db.close();
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const migrationsDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-migrations-'));
  tempDirs.push(dir);
  Object.entries(files).forEach(([name, sql]) => {
    writeFileSync(join(dir, name), sql);
  });
  return dir;
};

const tableNames = (): string[] =>
  db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map(({ name }) => name);

describe('runMigrations', () => {
  it('applies the bundled migrations to a fresh database, then is a no-op', () => {
    expect(runMigrations(db)).toEqual([
      '001_initial.sql',
      '002_checklist_items.sql',
      '003_completed_at.sql',
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
    expect(tableNames()).toEqual(expect.arrayContaining(['schema_migrations', 'tasks', 'users']));
    expect(runMigrations(db)).toEqual([]);
  });

  it('applies files in numeric order and only the new ones on the next run', () => {
    const dir = migrationsDir({
      '002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id));',
      '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
    });
    expect(runMigrations(db, dir)).toEqual(['001_a.sql', '002_b.sql']);

    writeFileSync(join(dir, '003_c.sql'), 'CREATE TABLE c (id INTEGER PRIMARY KEY);');
    expect(runMigrations(db, dir)).toEqual(['003_c.sql']);
  });

  it('rolls a failing migration back entirely and does not record it', () => {
    const dir = migrationsDir({
      '001_broken.sql':
        'CREATE TABLE half (id INTEGER PRIMARY KEY); INSERT INTO nowhere VALUES (1);',
    });

    expect(() => runMigrations(db, dir)).toThrow(/nowhere/);
    expect(tableNames()).not.toContain('half');
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 0 });
  });

  it('refuses a file that does not follow NNN_name.sql', () => {
    const dir = migrationsDir({ 'initial.sql': 'SELECT 1;' });
    expect(() => runMigrations(db, dir)).toThrow(/NNN_name\.sql/);
  });
});

describe('001_initial schema', () => {
  const userId = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
  const now = '2026-11-11T09:30:00.000Z';

  const insertUser = (id = userId, email = 'demo@example.com') =>
    db
      .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, email, 'scrypt$hash', now);

  const insertTask = (overrides: Record<string, unknown> = {}) => {
    const row = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: 'Task',
      notes: '',
      status: 'todo',
      priority: 'medium',
      due_date: null,
      position: 'a0',
      created_at: now,
      updated_at: now,
      ...overrides,
    };
    return db
      .prepare(
        `INSERT INTO tasks (id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at)
         VALUES (@id, @user_id, @title, @notes, @status, @priority, @due_date, @position, @created_at, @updated_at)`,
      )
      .run(row);
  };

  beforeEach(() => {
    runMigrations(db);
    insertUser();
  });

  it('accepts a valid task', () => {
    expect(insertTask().changes).toBe(1);
  });

  it.each([
    ['an unknown status', { status: 'archived' }],
    ['an unknown priority', { priority: 'urgent' }],
    ['an empty title', { title: '' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a malformed due date', { due_date: '12/01/2026' }],
    ['a missing owner', { user_id: crypto.randomUUID() }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => insertTask(overrides)).toThrow(/constraint/i);
  });

  it('keeps positions unique per user, not globally', () => {
    const otherUser = '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e';
    insertUser(otherUser, 'other@example.com');
    insertTask({ position: 'a0' });

    expect(() => insertTask({ position: 'a0' })).toThrow(/UNIQUE/);
    expect(insertTask({ user_id: otherUser, position: 'a0' }).changes).toBe(1);
  });

  it('rejects a duplicate or non-lower-case email', () => {
    expect(() => insertUser(crypto.randomUUID())).toThrow(/UNIQUE/);
    expect(() => insertUser(crypto.randomUUID(), 'Upper@example.com')).toThrow(/CHECK/);
  });

  it("deletes a user's tasks with the user", () => {
    insertTask();
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 });
  });
});

describe('002_checklist_items schema', () => {
  it('keeps items unique per task position, bounds their text and deletes them with the task', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const now = '2026-11-11T09:30:00.000Z';
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO tasks (id, user_id, title, notes, status, priority, position, created_at, updated_at) VALUES ('t1', 'u1', 'T', '', 'todo', 'medium', 'a0', ?, ?)",
    ).run(now, now);
    const insertItem = (id: string, text: string, position: string) =>
      db
        .prepare(
          "INSERT INTO checklist_items (id, task_id, text, notes, done, position, created_at, updated_at) VALUES (?, ?, ?, '', 0, ?, ?, ?)",
        )
        .run(id, 't1', text, position, now, now);

    insertItem('i1', 'Eggs', 'a0');
    expect(() => insertItem('i2', 'Milk', 'a0')).toThrow(/UNIQUE/);
    expect(() => insertItem('i3', '', 'a1')).toThrow(/CHECK/);
    db.prepare("DELETE FROM tasks WHERE id = 't1'").run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM checklist_items').get()).toEqual({ n: 0 });
    db.close();
  });
});

describe('003_completed_at backfill', () => {
  it('stamps tasks that were already done with their last update time', () => {
    const db = openDatabase(':memory:');
    const upTo002 = mkdtempSync(join(tmpdir(), 'todo-migrations-002-'));
    tempDirs.push(upTo002);
    ['001_initial.sql', '002_checklist_items.sql'].forEach((name) => {
      copyFileSync(join(MIGRATIONS_DIR, name), join(upTo002, name));
    });
    runMigrations(db, upTo002);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-11-11T00:00:00.000Z')",
    ).run();
    const insert = db.prepare(
      "INSERT INTO tasks (id, user_id, title, notes, status, priority, position, created_at, updated_at) VALUES (?, 'u1', 'T', '', ?, 'medium', ?, '2026-11-11T00:00:00.000Z', ?)",
    );
    insert.run('t-open', 'todo', 'a0', '2026-11-11T01:00:00.000Z');
    insert.run('t-done', 'done', 'a1', '2026-11-11T02:00:00.000Z');

    expect(runMigrations(db)).toEqual([
      '003_completed_at.sql',
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
    expect(db.prepare('SELECT id, completed_at FROM tasks ORDER BY id').all()).toEqual([
      { id: 't-done', completed_at: '2026-11-11T02:00:00.000Z' },
      { id: 't-open', completed_at: null },
    ]);
    db.close();
  });
});

describe('004_demo_content backfill', () => {
  it('records the first demo tasks for an existing demo account only', () => {
    const upTo003 = mkdtempSync(join(tmpdir(), 'todo-migrations-003-'));
    tempDirs.push(upTo003);
    ['001_initial.sql', '002_checklist_items.sql', '003_completed_at.sql'].forEach((name) => {
      copyFileSync(join(MIGRATIONS_DIR, name), join(upTo003, name));
    });
    runMigrations(db, upTo003);
    const addUser = db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', '2026-11-11T00:00:00.000Z')",
    );
    addUser.run('demo-id', 'demo@example.com');
    addUser.run('other-id', 'other@example.com');

    expect(runMigrations(db)).toEqual([
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
    const keysOf = (userId: string) =>
      db
        .prepare<[string], { key: string }>('SELECT key FROM demo_content WHERE user_id = ?')
        .all(userId)
        .map(({ key }) => key)
        .sort();
    expect(keysOf('demo-id')).toEqual([...FIRST_SEED_KEYS].sort());
    expect(keysOf('other-id')).toEqual([]);
  });

  it('records nothing when there is no demo account yet', () => {
    runMigrations(db);
    expect(db.prepare('SELECT count(*) AS n FROM demo_content').get()).toEqual({ n: 0 });
  });
});

describe('005_trash', () => {
  it('adds a nullable deleted_at (existing tasks stay out of the trash) and its indexes', () => {
    runMigrations(db);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-11-11T00:00:00.000Z')",
    ).run();
    db.prepare(
      "INSERT INTO tasks (id, user_id, title, status, priority, position, created_at, updated_at) VALUES ('t1', 'u1', 'T', 'todo', 'medium', 'a0', '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z')",
    ).run();

    expect(db.prepare('SELECT deleted_at FROM tasks').all()).toEqual([{ deleted_at: null }]);
    expect(
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name IN ('tasks_user_deleted_at', 'tasks_trash_purge') ORDER BY name",
        )
        .all()
        .map(({ name }) => name),
    ).toEqual(['tasks_trash_purge', 'tasks_user_deleted_at']);
  });
});

describe('migrations that rebuild a table (foreign keys off for that file)', () => {
  const PARENT =
    'CREATE TABLE parent (id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK (length(label) <= 3)) STRICT;';
  const CHILD =
    'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent (id) ON DELETE CASCADE) STRICT;';
  const REBUILD = [
    '-- migrate: foreign-keys-off',
    'CREATE TABLE parent_new (id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK (length(label) <= 10)) STRICT;',
    'INSERT INTO parent_new SELECT id, label FROM parent;',
    'DROP TABLE parent;',
    'ALTER TABLE parent_new RENAME TO parent;',
  ].join('\n');

  it('keeps the rows that reference the rebuilt table, and turns foreign keys back on', () => {
    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}` }));
    db.exec("INSERT INTO parent VALUES ('p', 'abc'); INSERT INTO child VALUES ('c', 'p');");

    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}`, '002_b.sql': REBUILD }));

    expect(db.prepare('SELECT parent_id FROM child').all()).toEqual([{ parent_id: 'p' }]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.exec("INSERT INTO parent VALUES ('q', 'abcdefghij');");
  });

  it('refuses a rebuild that leaves a broken reference, and keeps the old table', () => {
    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}` }));
    db.exec("INSERT INTO parent VALUES ('p', 'abc'); INSERT INTO child VALUES ('c', 'p');");
    const broken = REBUILD.replace('INSERT INTO parent_new SELECT id, label FROM parent;', '');

    expect(() =>
      runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}`, '002_b.sql': broken })),
    ).toThrow(/foreign key.*child/i);
    expect(db.prepare('SELECT id FROM parent').all()).toEqual([{ id: 'p' }]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('006_notes_doc', () => {
  it('lifts the notes cap to 20 000 and adds notes_doc, keeping every task, item and index', () => {
    const upTo005 = mkdtempSync(join(tmpdir(), 'todo-migrations-005-'));
    tempDirs.push(upTo005);
    [
      '001_initial.sql',
      '002_checklist_items.sql',
      '003_completed_at.sql',
      '004_demo_content.sql',
      '005_trash.sql',
    ].forEach((name) => {
      copyFileSync(join(MIGRATIONS_DIR, name), join(upTo005, name));
    });
    runMigrations(db, upTo005);
    db.exec(`
      INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-11-11T00:00:00.000Z');
      INSERT INTO tasks (id, user_id, title, notes, status, priority, position, created_at, updated_at, completed_at, deleted_at)
        VALUES ('t1', 'u1', 'T', 'kept', 'done', 'high', 'a0', '2026-11-11T00:00:00.000Z', '2026-11-11T01:00:00.000Z', '2026-11-11T01:00:00.000Z', NULL);
      INSERT INTO checklist_items (id, task_id, text, notes, done, position, created_at, updated_at)
        VALUES ('i1', 't1', 'Milk', '', 0, 'a0', '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z');
    `);
    const indexes = () =>
      db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
        )
        .all()
        .map(({ name }) => name);
    const before = indexes();

    expect(runMigrations(db)).toEqual(['006_notes_doc.sql', '007_session_version.sql']);

    expect(
      db.prepare('SELECT id, notes, status, completed_at, notes_doc FROM tasks').all(),
    ).toEqual([
      {
        id: 't1',
        notes: 'kept',
        status: 'done',
        completed_at: '2026-11-11T01:00:00.000Z',
        notes_doc: null,
      },
    ]);
    expect(db.prepare('SELECT id FROM checklist_items').all()).toEqual([{ id: 'i1' }]);
    expect(indexes()).toEqual(before);
    const insert = db.prepare(
      "INSERT INTO tasks (id, user_id, title, notes, status, priority, position, created_at, updated_at) VALUES (?, 'u1', 'T', ?, 'todo', 'low', ?, 'x', 'x')",
    );
    insert.run('t2', 'x'.repeat(20_000), 'a1');
    expect(() => insert.run('t3', 'x'.repeat(20_001), 'a2')).toThrow(/CHECK/);
    expect(() => insert.run('t4', '', 'a1')).toThrow(/UNIQUE/);
  });
});

describe('007_session_version', () => {
  it('gives every existing user session version 0 and refuses a negative version', () => {
    const upTo006 = mkdtempSync(join(tmpdir(), 'todo-migrations-006-'));
    tempDirs.push(upTo006);
    listMigrations(MIGRATIONS_DIR)
      .filter(({ name }) => name < '007')
      .forEach(({ name }) => {
        copyFileSync(join(MIGRATIONS_DIR, name), join(upTo006, name));
      });
    runMigrations(db, upTo006);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-11-11T00:00:00.000Z')",
    ).run();

    expect(runMigrations(db)).toEqual(['007_session_version.sql']);

    expect(db.prepare('SELECT id, session_version FROM users').all()).toEqual([
      { id: 'u1', session_version: 0 },
    ]);
    expect(() => db.prepare("UPDATE users SET session_version = -1 WHERE id = 'u1'").run()).toThrow(
      /CHECK/,
    );
    expect(() =>
      db.prepare("UPDATE users SET session_version = NULL WHERE id = 'u1'").run(),
    ).toThrow(/NOT NULL/);
  });
});

describe('the foreign-keys-off marker', () => {
  it('counts only on the first line of a file', () => {
    const PARENT = 'CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT;';
    const CHILD =
      'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent (id) ON DELETE CASCADE) STRICT;';
    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}` }));
    db.exec("INSERT INTO parent VALUES ('p'); INSERT INTO child VALUES ('c', 'p');");
    const late = 'DELETE FROM parent;\n-- migrate: foreign-keys-off\n';

    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}`, '002_b.sql': late }));

    expect(db.prepare('SELECT id FROM child').all()).toEqual([]);
  });
});

describe('table rebuilds are always marked (a data-loss class)', () => {
  const PARENT = 'CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT;';
  const CHILD =
    'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent (id) ON DELETE CASCADE) STRICT;';
  const REBUILD = [
    '-- migrate: foreign-keys-off',
    'CREATE TABLE parent_new (id TEXT PRIMARY KEY) STRICT;',
    'INSERT INTO parent_new SELECT id FROM parent;',
    'DROP TABLE parent;',
    'ALTER TABLE parent_new RENAME TO parent;',
  ].join('\n');
  const seeded = () => {
    runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}` }));
    db.exec("INSERT INTO parent VALUES ('p'); INSERT INTO child VALUES ('c', 'p');");
  };

  it('finds the marker after a byte-order mark and blank lines', () => {
    seeded();
    runMigrations(
      db,
      migrationsDir({ '001_a.sql': `${PARENT}${CHILD}`, '002_b.sql': `\uFEFF\n\n${REBUILD}` }),
    );
    expect(db.prepare('SELECT id FROM child').all()).toEqual([{ id: 'c' }]);
  });

  it('refuses a migration that drops a table without the marker, and applies nothing', () => {
    seeded();
    const unmarked = REBUILD.replace('-- migrate: foreign-keys-off\n', '');
    expect(() =>
      runMigrations(db, migrationsDir({ '001_a.sql': `${PARENT}${CHILD}`, '002_b.sql': unmarked })),
    ).toThrow(/002_b\.sql drops a table.*foreign-keys-off/);
    expect(db.prepare('SELECT id FROM child').all()).toEqual([{ id: 'c' }]);
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  });

  it('reads DROP TABLE in a comment as a comment', () => {
    expect(dropsTable('-- we never DROP TABLE here\nSELECT 1;')).toBe(false);
    expect(dropsTable('drop  table x;')).toBe(true);
  });

  it('ships every bundled migration that drops a table with the marker (006 included)', () => {
    const files = listMigrations(MIGRATIONS_DIR).map((migration) => ({
      name: migration.name,
      sql: readMigration(MIGRATIONS_DIR, migration),
    }));
    const notes = files.find(({ name }) => name === '006_notes_doc.sql');
    expect(notes !== undefined && dropsTable(notes.sql) && runsWithKeysOff(notes.sql)).toBe(true);
    files
      .filter(({ sql }) => dropsTable(sql))
      .forEach(({ name, sql }) => {
        expect(runsWithKeysOff(sql), name).toBe(true);
      });
  });
});

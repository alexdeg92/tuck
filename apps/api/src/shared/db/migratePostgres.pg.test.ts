import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestPool } from '../../testingPostgres';
import { FIRST_SEED_KEYS } from '../../demoContent';
import { POSTGRES_MIGRATIONS_DIR, runPostgresMigrations } from './migratePostgres';
import { listMigrations } from './migrationFiles';

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((dir) => {
    rmSync(dir, { recursive: true, force: true });
  });
});

const migrationsDir = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'todo-pg-migrations-'));
  tempDirs.push(dir);
  Object.entries(files).forEach(([name, sql]) => {
    writeFileSync(join(dir, name), sql);
  });
  return dir;
};

describe('runPostgresMigrations', () => {
  it('applies the bundled migrations to a fresh schema, then is a no-op', async () => {
    const pool = await openTestPool();

    expect(await runPostgresMigrations(pool)).toEqual([
      '001_initial.sql',
      '002_checklist_items.sql',
      '003_completed_at.sql',
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
    expect(await runPostgresMigrations(pool)).toEqual([]);
  });

  it('applies each migration once when two instances start together', async () => {
    const pool = await openTestPool();

    const runs = await Promise.all([runPostgresMigrations(pool), runPostgresMigrations(pool)]);

    expect(runs.flat()).toEqual([
      '001_initial.sql',
      '002_checklist_items.sql',
      '003_completed_at.sql',
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
  });

  it('rolls the whole run back on a failing migration, records nothing, and frees its client', async () => {
    const pool = await openTestPool();
    const dir = migrationsDir({
      '001_broken.sql':
        'CREATE TABLE half (id integer PRIMARY KEY); INSERT INTO nowhere VALUES (1);',
    });

    await expect(runPostgresMigrations(pool, dir)).rejects.toThrow(/nowhere/);
    expect(pool.totalCount - pool.idleCount).toBe(0);

    const tables = await pool.query(
      "SELECT to_regclass('half') AS half, to_regclass('schema_migrations') AS bookkeeping",
    );
    expect(tables.rows).toEqual([{ half: null, bookkeeping: null }]);
  });
});

describe('postgres 001_initial schema', () => {
  const userId = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';

  const migrated = async () => {
    const pool = await openTestPool();
    await runPostgresMigrations(pool);
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, 'demo@example.com', 'scrypt$x', now())",
      [userId],
    );
    const insertTask = (overrides: Record<string, unknown> = {}) => {
      const row = {
        title: 'Task',
        status: 'todo',
        priority: 'medium',
        position: 'a0',
        due_date: null,
        user_id: userId,
        ...overrides,
      };
      return pool.query(
        `INSERT INTO tasks (id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, '', $3, $4, $5, $6, now(), now())`,
        [row.user_id, row.title, row.status, row.priority, row.due_date, row.position],
      );
    };
    return { pool, insertTask };
  };

  it.each([
    ['an unknown status', { status: 'archived' }],
    ['an unknown priority', { priority: 'urgent' }],
    ['an empty title', { title: '' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a missing owner', { user_id: '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e' }],
  ])('rejects %s', async (_label, overrides) => {
    const { insertTask } = await migrated();
    await expect(insertTask(overrides)).rejects.toThrow();
  });

  it('keeps positions unique per user and sorts them byte by byte', async () => {
    const { pool, insertTask } = await migrated();
    await insertTask({ position: 'a0' });
    await expect(insertTask({ position: 'a0' })).rejects.toMatchObject({ code: '23505' });

    await insertTask({ position: 'Zz' });
    await insertTask({ position: 'a0V' });
    const order = await pool.query<{ position: string }>(
      'SELECT position FROM tasks ORDER BY position',
    );
    expect(order.rows.map(({ position }) => position)).toEqual(['Zz', 'a0', 'a0V']);
  });

  it('rejects a duplicate or non-lower-case email', async () => {
    const { pool } = await migrated();
    const insert = (email: string) =>
      pool.query(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES (gen_random_uuid(), $1, 'x', now())",
        [email],
      );

    await expect(insert('demo@example.com')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('Upper@example.com')).rejects.toMatchObject({ code: '23514' });
  });

  it("deletes a user's tasks with the user", async () => {
    const { pool, insertTask } = await migrated();
    await insertTask();
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows).toEqual([{ n: 0 }]);
  });

  it('005_trash: adds a nullable deleted_at (existing tasks stay out of the trash) and its indexes', async () => {
    const { pool, insertTask } = await migrated();
    await insertTask();

    expect((await pool.query('SELECT deleted_at FROM tasks')).rows).toEqual([{ deleted_at: null }]);
    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'tasks' AND indexname IN ('tasks_user_deleted_at', 'tasks_trash_purge') ORDER BY indexname",
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      'tasks_trash_purge',
      'tasks_user_deleted_at',
    ]);
  });
});

describe('004_demo_content backfill on Postgres', () => {
  it('records the first demo tasks for an existing demo account only', async () => {
    const pool = await openTestPool();
    const upTo003 = mkdtempSync(join(tmpdir(), 'todo-pg-migrations-003-'));
    tempDirs.push(upTo003);
    ['001_initial.sql', '002_checklist_items.sql', '003_completed_at.sql'].forEach((name) => {
      copyFileSync(join(POSTGRES_MIGRATIONS_DIR, name), join(upTo003, name));
    });
    await runPostgresMigrations(pool, upTo003);
    const demo = crypto.randomUUID();
    const other = crypto.randomUUID();
    for (const [id, email] of [
      [demo, 'demo@example.com'],
      [other, 'other@example.com'],
    ]) {
      await pool.query(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, 'x', now())",
        [id, email],
      );
    }

    expect(await runPostgresMigrations(pool)).toEqual([
      '004_demo_content.sql',
      '005_trash.sql',
      '006_notes_doc.sql',
      '007_session_version.sql',
    ]);
    const keysOf = async (userId: string) =>
      (
        await pool.query<{ key: string }>('SELECT key FROM demo_content WHERE user_id = $1', [
          userId,
        ])
      ).rows
        .map(({ key }) => key)
        .sort();
    expect(await keysOf(demo)).toEqual([...FIRST_SEED_KEYS].sort());
    expect(await keysOf(other)).toEqual([]);
  });
});

describe('006_notes_doc on Postgres', () => {
  it('lifts the notes cap to 20 000 and adds a jsonb notes_doc', async () => {
    const pool = await openTestPool();
    await runPostgresMigrations(pool);
    const user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, 'a@example.com', 'x', now())",
      [user],
    );
    const insert = (position: string, notes: string) =>
      pool.query(
        `INSERT INTO tasks (id, user_id, title, notes, status, priority, position, created_at, updated_at, notes_doc)
         VALUES ($1, $2, 'T', $3, 'todo', 'low', $4, now(), now(), '{"type":"doc"}'::jsonb)`,
        [crypto.randomUUID(), user, notes, position],
      );

    await insert('a0', 'x'.repeat(20_000));
    await expect(insert('a1', 'x'.repeat(20_001))).rejects.toThrow(/check constraint/);
  });
});

describe('007_session_version on Postgres', () => {
  it('gives every existing user session version 0 and refuses a negative version', async () => {
    const pool = await openTestPool();
    const upTo006 = mkdtempSync(join(tmpdir(), 'todo-pg-migrations-006-'));
    tempDirs.push(upTo006);
    listMigrations(POSTGRES_MIGRATIONS_DIR)
      .filter(({ name }) => name < '007')
      .forEach(({ name }) => {
        copyFileSync(join(POSTGRES_MIGRATIONS_DIR, name), join(upTo006, name));
      });
    await runPostgresMigrations(pool, upTo006);
    const user = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, 'a@example.com', 'x', now())",
      [user],
    );

    expect(await runPostgresMigrations(pool)).toEqual(['007_session_version.sql']);

    expect(
      (await pool.query('SELECT session_version FROM users WHERE id = $1', [user])).rows,
    ).toEqual([{ session_version: 0 }]);
    await expect(
      pool.query('UPDATE users SET session_version = -1 WHERE id = $1', [user]),
    ).rejects.toThrow(/check constraint/);
  });
});

import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { runPostgresMigrations } from '../../../shared/db/migratePostgres';
import { openTestPool } from '../../../testingPostgres';
import { describeTrashRepository } from '../application/trashRepository.contract';
import {
  describeTaskRepository,
  type RepositoryHarness,
} from '../application/taskRepository.contract';
import { keyBetween } from '../domain/ordering';
import { makePostgresTaskRepository } from './postgresTaskRepository';

const harness = async (): Promise<RepositoryHarness> => {
  const pool = await openTestPool();
  await runPostgresMigrations(pool);
  const createUser = async () => {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, 'x', now())",
      [id, `${id}@example.com`],
    );
    return id;
  };
  return { tasks: makePostgresTaskRepository(pool), createUser };
};

describeTaskRepository('postgres', harness);
describeTrashRepository('postgres', harness);

/**
 * The reply to a trash or a restore must be that write's own snapshot. A row lock held by the
 * test queues the two writes in a known order. When it's released, the second write commits
 * while the first one's client is still on its way back to read its reply.
 */
describe('postgres trash and restore reply with their own write', () => {
  const DELETED = '2026-11-12T10:00:00.000Z';

  const setup = async () => {
    const pool = await openTestPool();
    await runPostgresMigrations(pool);
    const userId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, 'x', now())",
      [userId, `${userId}@example.com`],
    );
    const tasks = makePostgresTaskRepository(pool);
    const task = await tasks.insertAtTop(
      userId,
      {
        id: crypto.randomUUID(),
        title: 'Raced',
        notes: '',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        completedAt: null,
        createdAt: DELETED,
        updatedAt: DELETED,
      },
      keyBetween,
    );
    return { pool, tasks, userId, id: task.id };
  };

  /** Holds the task's row lock until the given trash/restore writes are queued behind it. */
  const queuedBehindLock = async <T>(
    pool: pg.Pool,
    id: string,
    writes: (() => Promise<T>)[],
  ): Promise<PromiseSettledResult<T>[]> => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE', [id]);
      const started: Promise<T>[] = [];
      for (const write of writes) {
        started.push(write());
        const queued = started.length;
        await vi.waitFor(async () => {
          const waiting = await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%UPDATE tasks SET deleted_at%'",
          );
          expect(waiting.rows[0]?.n).toBeGreaterThanOrEqual(queued);
        });
      }
      await holder.query('COMMIT');
      return await Promise.allSettled(started);
    } finally {
      holder.release();
    }
  };

  it('a trash that a restore overtakes still answers with the trashed task', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { pool, tasks, userId, id } = await setup();

      const [trashed, restored] = await queuedBehindLock<unknown>(pool, id, [
        () => tasks.trash(userId, id, DELETED),
        () => tasks.restore(userId, id),
      ]);

      expect(trashed).toMatchObject({ status: 'fulfilled', value: { id, deletedAt: DELETED } });
      expect(restored).toMatchObject({ status: 'fulfilled', value: { id } });
      expect((await tasks.list(userId)).map((task) => task.id)).toEqual([id]);
    }
  });

  it('a restore that a trash overtakes still answers with the restored task', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { pool, tasks, userId, id } = await setup();
      await tasks.trash(userId, id, DELETED);

      const [restored, trashed] = await queuedBehindLock<unknown>(pool, id, [
        () => tasks.restore(userId, id),
        () => tasks.trash(userId, id, DELETED),
      ]);

      expect(restored).toMatchObject({ status: 'fulfilled', value: { id } });
      expect(trashed).toMatchObject({ status: 'fulfilled', value: { id, deletedAt: DELETED } });
      expect((await tasks.listTrash(userId)).map((task) => task.id)).toEqual([id]);
    }
  });

  it('a move that a trash overtakes leaves the trashed row where it was', async () => {
    const { pool, tasks, userId, id } = await setup();
    const other = await tasks.insertAtTop(
      userId,
      {
        id: crypto.randomUUID(),
        title: 'Above',
        notes: '',
        status: 'todo',
        priority: 'medium',
        dueDate: null,
        completedAt: null,
        createdAt: DELETED,
        updatedAt: DELETED,
      },
      keyBetween,
    );
    const before = (
      await pool.query<{ position: string }>('SELECT position FROM tasks WHERE id = $1', [id])
    ).rows[0]?.position;

    // The move reads the live task, then queues on the row; the holder trashes it and commits.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM tasks WHERE id = $1 FOR UPDATE', [id]);
      const moved = tasks.moveAfter(userId, id, null, keyBetween, DELETED);
      await vi.waitFor(async () => {
        const waiting = await pool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE tasks SET position%'",
        );
        expect(waiting.rows[0]?.n).toBe(1);
      });
      await holder.query('UPDATE tasks SET deleted_at = $2 WHERE id = $1', [id, DELETED]);
      await holder.query('COMMIT');

      expect(await moved).toBeUndefined();
    } finally {
      holder.release();
    }
    const after = await pool.query<{ position: string }>(
      'SELECT position FROM tasks WHERE id = $1',
      [id],
    );
    expect(after.rows[0]?.position).toBe(before);
    expect(other.position < (before ?? '')).toBe(true);
  });
});

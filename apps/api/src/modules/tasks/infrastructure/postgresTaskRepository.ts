import { NoteDocShape, Task } from '@todo/contracts';
import type pg from 'pg';
import {
  isUniqueViolation,
  lockForTransaction,
  withTransaction,
} from '../../../shared/db/postgres';
import { conflict, staleTask } from '../../../shared/errors';
import { nextUpdatedAt } from '../domain/version';
import type {
  DeletedTask,
  NewTask,
  StoredTask,
  TaskEdit,
  TaskRepository,
} from '../application/ports';
import { completedAtAfter } from '../domain/completion';
import type { KeyBetween } from '../domain/ordering';

type TaskRow = {
  id: string;
  title: string;
  notes: string;
  status: string;
  priority: string;
  due_date: string | null;
  position: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  deleted_at: Date | null;

  notes_doc: unknown;
  checklist_done: number;
  checklist_total: number;
};

const toTask = (row: TaskRow): Task =>
  Task.parse({
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    checklist: { done: row.checklist_done, total: row.checklist_total },
  });

const toStored = (row: TaskRow): StoredTask => ({
  ...toTask(row),
  notesDoc: row.notes_doc === null ? null : NoteDocShape.parse(row.notes_doc),
});

const toDeletedTask = (row: TaskRow): DeletedTask => {
  if (row.deleted_at === null) throw new Error(`task ${row.id} is not in the trash`);
  return { ...toTask(row), deletedAt: row.deleted_at.toISOString() };
};

const optional =
  <Row, T>(map: (row: Row) => T) =>
  (row: Row | undefined): T | undefined =>
    row === undefined ? undefined : map(row);

type TaskWrite = TaskEdit & { completedAt?: string | null };

const COLUMNS: Record<keyof TaskWrite, string> = {
  title: 'title',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  dueDate: 'due_date',
  completedAt: 'completed_at',
  notesDoc: 'notes_doc',
};

const isUpdateField = (key: string): key is keyof TaskWrite => key in COLUMNS;

const guardPosition = async <T>(write: Promise<T>): Promise<T> => {
  try {
    return await write;
  } catch (error) {
    if (isUniqueViolation(error, 'tasks_user_position_unique')) {
      throw conflict('The list changed while saving; please retry');
    }
    throw error;
  }
};

const TASK_COLUMNS = `t.*,
    (SELECT count(*)::int FROM checklist_items i WHERE i.task_id = t.id AND i.done) AS checklist_done,
    (SELECT count(*)::int FROM checklist_items i WHERE i.task_id = t.id) AS checklist_total`;
const TASK_SELECT = `SELECT ${TASK_COLUMNS} FROM tasks t`;

const updateReturningTask = (update: string) =>
  `WITH changed AS (${update} RETURNING *) SELECT ${TASK_COLUMNS} FROM changed t`;

const LIST_ORDER = `t.status = 'done',
  CASE WHEN t.status = 'done' THEN NULL ELSE t.position END,
  t.completed_at DESC NULLS LAST,
  t.id`;

type Db = pg.Pool | pg.PoolClient;

const setClause = (sets: [string, unknown][]): string =>
  sets.map(([column], index) => `${column} = $${String(index + 3)}`).join(', ');

export const makePostgresTaskRepository = (pool: pg.Pool): TaskRepository => {
  const lockUser = (client: pg.PoolClient, userId: string) =>
    lockForTransaction(client, `tasks:${userId}`);

  const listTasks = async (db: Db, userId: string): Promise<Task[]> =>
    (
      await db.query<TaskRow>(
        `${TASK_SELECT} WHERE t.user_id = $1 AND t.deleted_at IS NULL ORDER BY ${LIST_ORDER}`,
        [userId],
      )
    ).rows.map(toTask);

  const find = async (db: Db, userId: string, id: string): Promise<Task | undefined> =>
    optional(toTask)(
      (
        await db.query<TaskRow>(
          `${TASK_SELECT} WHERE t.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
          [id, userId],
        )
      ).rows[0],
    );

  const findStored = async (db: Db, userId: string, id: string): Promise<StoredTask | undefined> =>
    optional(toStored)(
      (
        await db.query<TaskRow>(
          `${TASK_SELECT} WHERE t.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
          [id, userId],
        )
      ).rows[0],
    );

  const count = async (sql: string, values: unknown[]): Promise<number> =>
    (await pool.query(sql, values)).rowCount ?? 0;

  const insertAtTop = (userId: string, task: NewTask, keyBetween: KeyBetween) =>
    withTransaction(pool, async (client) => {
      await lockUser(client, userId);
      const first = await client.query<{ position: string }>(
        'SELECT position FROM tasks WHERE user_id = $1 ORDER BY position LIMIT 1',
        [userId],
      );
      const position = keyBetween(null, first.rows[0]?.position ?? null);
      await client.query(
        `INSERT INTO tasks (id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          task.id,
          userId,
          task.title,
          task.notes,
          task.status,
          task.priority,
          task.dueDate,
          position,
          task.createdAt,
          task.updatedAt,
          task.completedAt,
        ],
      );
      return find(client, userId, task.id);
    });

  const moveAfter = (
    userId: string,
    id: string,
    afterId: string | null,
    keyBetween: KeyBetween,
    updatedAt: string,
  ) =>
    withTransaction(pool, async (client) => {
      await lockUser(client, userId);
      const task = await find(client, userId, id);
      const anchor = afterId === null ? null : await find(client, userId, afterId);
      if (task === undefined || anchor === undefined) return undefined;
      const before = anchor?.position ?? null;
      const successor = await client.query<{ position: string }>(
        `SELECT position FROM tasks
         WHERE user_id = $1 AND id <> $2 AND ($3::text IS NULL OR position > $3)
         ORDER BY position LIMIT 1`,
        [userId, id, before],
      );
      const position = keyBetween(before, successor.rows[0]?.position ?? null);
      // The user lock doesn't hold off a trash: a task trashed since the read above is skipped
      // here (the row is re-checked when its lock frees), so its reserved position stays put.
      await client.query(
        'UPDATE tasks SET position = $3, updated_at = $4 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, userId, position, nextUpdatedAt(task.updatedAt, updatedAt)],
      );
      return find(client, userId, id);
    });

  /**
   * Locks the row, reads its status and writes in one transaction: the stamp is never stale, and
   * the expectedUpdatedAt precondition is checked under the same lock (no read-then-write race).
   */
  const update = (
    userId: string,
    id: string,
    changes: TaskEdit,
    updatedAt: string,
    expectedUpdatedAt: string | undefined,
  ) =>
    withTransaction(pool, async (client) => {
      const locked = await client.query<TaskRow>(
        `${TASK_SELECT} WHERE t.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL FOR UPDATE OF t`,
        [id, userId],
      );
      const current = locked.rows[0];
      if (current === undefined) return undefined;
      if (expectedUpdatedAt !== undefined && toTask(current).updatedAt !== expectedUpdatedAt) {
        throw staleTask(toStored(current));
      }

      const stamp = nextUpdatedAt(toTask(current).updatedAt, updatedAt);
      const write: TaskWrite =
        changes.status === undefined
          ? changes
          : {
              ...changes,
              completedAt: completedAtAfter(toTask(current), changes.status, stamp),
            };
      const sets: [string, unknown][] = [
        ...Object.keys(write)
          .filter(isUpdateField)
          .filter((key) => write[key] !== undefined)
          .map((key): [string, unknown] => [
            COLUMNS[key],

            key === 'notesDoc'
              ? write.notesDoc === null
                ? null
                : JSON.stringify(write.notesDoc)
              : write[key],
          ]),
        ['updated_at', stamp],
      ];
      await client.query(`UPDATE tasks SET ${setClause(sets)} WHERE id = $1 AND user_id = $2`, [
        id,
        userId,
        ...sets.map(([, value]) => value),
      ]);
      return findStored(client, userId, id);
    });

  return {
    list: (userId) => listTasks(pool, userId),
    findById: (userId, id) => findStored(pool, userId, id),
    insertAtTop: async (userId, task, keyBetween) => {
      const inserted = await guardPosition(insertAtTop(userId, task, keyBetween));
      if (inserted === undefined) throw new Error('the inserted task could not be read back');
      return inserted;
    },
    update: (userId, id, changes, updatedAt, expectedUpdatedAt) =>
      update(userId, id, changes, updatedAt, expectedUpdatedAt),
    moveAfter: (userId, id, afterId, keyBetween, updatedAt) =>
      guardPosition(moveAfter(userId, id, afterId, keyBetween, updatedAt)),

    // position stays reserved and restoring it can't collide.
    trash: async (userId, id, deletedAt) =>
      optional(toDeletedTask)(
        (
          await pool.query<TaskRow>(
            updateReturningTask(
              'UPDATE tasks SET deleted_at = coalesce(deleted_at, $3) WHERE id = $1 AND user_id = $2',
            ),
            [id, userId, deletedAt],
          )
        ).rows[0],
      ),
    listTrash: async (userId) =>
      (
        await pool.query<TaskRow>(
          `${TASK_SELECT} WHERE t.user_id = $1 AND t.deleted_at IS NOT NULL
           ORDER BY t.deleted_at DESC, t.id`,
          [userId],
        )
      ).rows.map(toDeletedTask),
    restore: async (userId, id) =>
      optional(toTask)(
        (
          await pool.query<TaskRow>(
            updateReturningTask(
              'UPDATE tasks SET deleted_at = NULL WHERE id = $1 AND user_id = $2',
            ),
            [id, userId],
          )
        ).rows[0],
      ),
    deleteForever: async (userId, id) =>
      (await count('DELETE FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL', [
        id,
        userId,
      ])) > 0,
    emptyTrash: (userId) =>
      count('DELETE FROM tasks WHERE user_id = $1 AND deleted_at IS NOT NULL', [userId]),

    purgeDeletedBefore: (cutoff) => count('DELETE FROM tasks WHERE deleted_at <= $1', [cutoff]),
  };
};

import { Instant, NoteDocShape, Task } from '@todo/contracts';
import type { Db } from '../../../shared/db/connection';
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
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;

  notes_doc: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    checklist: { done: row.checklist_done, total: row.checklist_total },
  });

const toStored = (row: TaskRow): StoredTask => ({
  ...toTask(row),
  notesDoc: row.notes_doc === null ? null : NoteDocShape.parse(JSON.parse(row.notes_doc)),
});

/** A trashed row: the task plus when it was deleted (parsed, so a NULL can't slip through). */
const toDeletedTask = (row: TaskRow): DeletedTask => ({
  ...toTask(row),
  deletedAt: Instant.parse(row.deleted_at),
});

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

const guardPosition = <T>(write: () => T): T => {
  try {
    return write();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('UNIQUE constraint failed: tasks.user_id, tasks.position')
    ) {
      throw conflict('The list changed while saving; please retry');
    }
    throw error;
  }
};

const TASK_SELECT = `SELECT t.*,
    (SELECT count(*) FROM checklist_items i WHERE i.task_id = t.id AND i.done = 1) AS checklist_done,
    (SELECT count(*) FROM checklist_items i WHERE i.task_id = t.id) AS checklist_total
  FROM tasks t`;

const LIST_ORDER = `t.status = 'done',
  CASE WHEN t.status = 'done' THEN NULL ELSE t.position END,
  t.completed_at DESC,
  t.id`;

export const makeSqliteTaskRepository = (db: Db): TaskRepository => {
  const listStatement = db.prepare<{ userId: string }, TaskRow>(
    `${TASK_SELECT} WHERE t.user_id = @userId AND t.deleted_at IS NULL ORDER BY ${LIST_ORDER}`,
  );
  const findStatement = db.prepare<{ userId: string; id: string }, TaskRow>(
    `${TASK_SELECT} WHERE t.id = @id AND t.user_id = @userId AND t.deleted_at IS NULL`,
  );

  const findAnyStatement = db.prepare<{ userId: string; id: string }, TaskRow>(
    `${TASK_SELECT} WHERE t.id = @id AND t.user_id = @userId`,
  );
  const firstPosition = db
    .prepare<{ userId: string }, string>(
      'SELECT position FROM tasks WHERE user_id = @userId ORDER BY position LIMIT 1',
    )
    .pluck();
  const successorPosition = db
    .prepare<{ userId: string; id: string; before: string | null }, string>(
      `SELECT position FROM tasks
       WHERE user_id = @userId AND id <> @id AND (@before IS NULL OR position > @before)
       ORDER BY position LIMIT 1`,
    )
    .pluck();
  const insertStatement = db.prepare<Record<string, unknown>>(
    `INSERT INTO tasks (id, user_id, title, notes, status, priority, due_date, position, created_at, updated_at, completed_at)
     VALUES (@id, @userId, @title, @notes, @status, @priority, @dueDate, @position, @createdAt, @updatedAt, @completedAt)`,
  );
  const setPosition = db.prepare<{
    userId: string;
    id: string;
    position: string;
    updatedAt: string;
  }>(
    'UPDATE tasks SET position = @position, updated_at = @updatedAt WHERE id = @id AND user_id = @userId AND deleted_at IS NULL',
  );

  // task's position stays reserved and restoring it can't collide.
  const trashStatement = db.prepare<{ userId: string; id: string; deletedAt: string }>(
    `UPDATE tasks SET deleted_at = coalesce(deleted_at, @deletedAt)
     WHERE id = @id AND user_id = @userId`,
  );
  const listTrashStatement = db.prepare<{ userId: string }, TaskRow>(
    `${TASK_SELECT} WHERE t.user_id = @userId AND t.deleted_at IS NOT NULL
     ORDER BY t.deleted_at DESC, t.id`,
  );
  const restoreStatement = db.prepare<{ userId: string; id: string }>(
    'UPDATE tasks SET deleted_at = NULL WHERE id = @id AND user_id = @userId',
  );
  const deleteForeverStatement = db.prepare<{ userId: string; id: string }>(
    'DELETE FROM tasks WHERE id = @id AND user_id = @userId AND deleted_at IS NOT NULL',
  );
  const emptyTrashStatement = db.prepare<{ userId: string }>(
    'DELETE FROM tasks WHERE user_id = @userId AND deleted_at IS NOT NULL',
  );

  const purgeStatement = db.prepare<{ cutoff: string }>(
    'DELETE FROM tasks WHERE deleted_at <= @cutoff',
  );

  const trash = db.transaction((userId: string, id: string, deletedAt: string) => {
    trashStatement.run({ userId, id, deletedAt });
    return findAnyStatement.get({ userId, id });
  });
  const restore = db.transaction((userId: string, id: string) =>
    restoreStatement.run({ userId, id }).changes > 0
      ? findAnyStatement.get({ userId, id })
      : undefined,
  );

  const find = (userId: string, id: string): Task | undefined =>
    optional(toTask)(findStatement.get({ userId, id }));

  const findStored = (userId: string, id: string): StoredTask | undefined =>
    optional(toStored)(findStatement.get({ userId, id }));

  const insertAtTop = db.transaction((userId: string, task: NewTask, keyBetween: KeyBetween) => {
    const position = keyBetween(null, firstPosition.get({ userId }) ?? null);
    insertStatement.run({ ...task, userId, position });
  });

  const moveAfter = db.transaction(
    (
      userId: string,
      id: string,
      afterId: string | null,
      keyBetween: KeyBetween,
      updatedAt: string,
    ): boolean => {
      const task = findStatement.get({ userId, id });
      const anchor = afterId === null ? null : findStatement.get({ userId, id: afterId });
      if (task === undefined || anchor === undefined) return false;
      const before = anchor?.position ?? null;
      const after = successorPosition.get({ userId, id, before }) ?? null;
      setPosition.run({
        userId,
        id,
        position: keyBetween(before, after),
        updatedAt: nextUpdatedAt(toTask(task).updatedAt, updatedAt),
      });
      return true;
    },
  );

  const update = db.transaction(
    (
      userId: string,
      id: string,
      changes: TaskEdit,
      updatedAt: string,
      expectedUpdatedAt: string | undefined,
    ): boolean => {
      const current = findStatement.get({ userId, id });
      if (current === undefined) return false;
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
      return writeTask(userId, id, write, stamp);
    },
  );

  const docValue = (doc: TaskEdit['notesDoc']) =>
    doc === undefined ? {} : { notesDoc: doc === null ? null : JSON.stringify(doc) };

  const writeTask = (userId: string, id: string, changes: TaskWrite, updatedAt: string) => {
    const fields = Object.keys(changes)
      .filter(isUpdateField)
      .filter((key) => changes[key] !== undefined);
    const assignments = [
      ...fields.map((key) => `${COLUMNS[key]} = @${key}`),
      'updated_at = @updatedAt',
    ];
    return (
      db
        .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = @id AND user_id = @userId`)
        .run({ ...changes, ...docValue(changes.notesDoc), id, userId, updatedAt }).changes > 0
    );
  };

  return {
    list: async (userId) => listStatement.all({ userId }).map(toTask),
    findById: async (userId, id) => findStored(userId, id),
    insertAtTop: async (userId, task, keyBetween) => {
      guardPosition(() => {
        insertAtTop(userId, task, keyBetween);
      });
      const inserted = find(userId, task.id);
      if (inserted === undefined) throw new Error('the inserted task could not be read back');
      return inserted;
    },
    update: async (userId, id, changes, updatedAt, expectedUpdatedAt) =>
      update(userId, id, changes, updatedAt, expectedUpdatedAt)
        ? findStored(userId, id)
        : undefined,
    moveAfter: async (userId, id, afterId, keyBetween, updatedAt) =>
      guardPosition(() => moveAfter(userId, id, afterId, keyBetween, updatedAt))
        ? find(userId, id)
        : undefined,
    trash: async (userId, id, deletedAt) => optional(toDeletedTask)(trash(userId, id, deletedAt)),
    listTrash: async (userId) => listTrashStatement.all({ userId }).map(toDeletedTask),
    restore: async (userId, id) => optional(toTask)(restore(userId, id)),
    deleteForever: async (userId, id) => deleteForeverStatement.run({ userId, id }).changes > 0,
    emptyTrash: async (userId) => emptyTrashStatement.run({ userId }).changes,
    purgeDeletedBefore: async (cutoff) => purgeStatement.run({ cutoff }).changes,
  };
};

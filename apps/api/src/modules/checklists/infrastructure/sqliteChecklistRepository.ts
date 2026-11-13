import { ChecklistItem, type UpdateChecklistItemInput } from '@todo/contracts';
import type { Db } from '../../../shared/db/connection';
import { conflict } from '../../../shared/errors';
import type { KeyBetween } from '../../tasks/application';
import type { ChecklistRepository, NewChecklistItem } from '../application/ports';

type ItemRow = {
  id: string;
  task_id: string;
  text: string;
  notes: string;
  done: number;
  position: string;
  created_at: string;
  updated_at: string;
};

const toItem = (row: ItemRow): ChecklistItem =>
  ChecklistItem.parse({
    id: row.id,
    taskId: row.task_id,
    text: row.text,
    notes: row.notes,
    done: row.done === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const optional =
  <Row, T>(map: (row: Row) => T) =>
  (row: Row | undefined): T | undefined =>
    row === undefined ? undefined : map(row);

const ITEM_COLUMNS: Record<keyof UpdateChecklistItemInput, string> = {
  text: 'text',
  notes: 'notes',
  done: 'done',
};

const isItemUpdateField = (key: string): key is keyof UpdateChecklistItemInput =>
  key in ITEM_COLUMNS;

const guardPosition = <T>(write: () => T): T => {
  try {
    return write();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        'UNIQUE constraint failed: checklist_items.task_id, checklist_items.position',
      )
    ) {
      throw conflict('The list changed while saving; please retry');
    }
    throw error;
  }
};

export const makeSqliteChecklistRepository = (db: Db): ChecklistRepository => {
  const userItemsStatement = db.prepare<{ userId: string }, ItemRow>(
    `SELECT i.* FROM checklist_items i JOIN tasks t ON t.id = i.task_id
     WHERE t.user_id = @userId AND t.deleted_at IS NULL ORDER BY i.task_id, i.position`,
  );
  const ownsTask = db
    .prepare<{ userId: string; taskId: string }, number>(
      'SELECT 1 FROM tasks WHERE id = @taskId AND user_id = @userId AND deleted_at IS NULL',
    )
    .pluck();
  const listItemsStatement = db.prepare<{ taskId: string }, ItemRow>(
    'SELECT * FROM checklist_items WHERE task_id = @taskId ORDER BY position',
  );
  const findItemStatement = db.prepare<{ userId: string; taskId: string; itemId: string }, ItemRow>(
    `SELECT i.* FROM checklist_items i JOIN tasks t ON t.id = i.task_id
     WHERE i.id = @itemId AND i.task_id = @taskId AND t.user_id = @userId
       AND t.deleted_at IS NULL`,
  );
  const countItems = db
    .prepare<{ taskId: string }, number>(
      'SELECT count(*) FROM checklist_items WHERE task_id = @taskId',
    )
    .pluck();
  const lastItemPosition = db
    .prepare<{ taskId: string }, string>(
      'SELECT position FROM checklist_items WHERE task_id = @taskId ORDER BY position DESC LIMIT 1',
    )
    .pluck();
  const successorItemPosition = db
    .prepare<{ taskId: string; itemId: string; before: string | null }, string>(
      `SELECT position FROM checklist_items
       WHERE task_id = @taskId AND id <> @itemId AND (@before IS NULL OR position > @before)
       ORDER BY position LIMIT 1`,
    )
    .pluck();
  const insertItemStatement = db.prepare<Record<string, unknown>, ItemRow>(
    `INSERT INTO checklist_items (id, task_id, text, notes, done, position, created_at, updated_at)
     VALUES (@id, @taskId, @text, @notes, @done, @position, @createdAt, @updatedAt)
     RETURNING *`,
  );
  const setItemPosition = db.prepare<
    { itemId: string; position: string; updatedAt: string },
    ItemRow
  >(
    'UPDATE checklist_items SET position = @position, updated_at = @updatedAt WHERE id = @itemId RETURNING *',
  );
  const deleteItemStatement = db.prepare<{ userId: string; taskId: string; itemId: string }>(
    `DELETE FROM checklist_items
     WHERE id = @itemId AND task_id = @taskId
       AND task_id IN (SELECT id FROM tasks WHERE user_id = @userId AND deleted_at IS NULL)`,
  );

  const insertItemAtBottom = db.transaction(
    (
      userId: string,
      taskId: string,
      item: NewChecklistItem,
      keyBetween: KeyBetween,
      maxItems: number,
    ): ItemRow | undefined => {
      if (ownsTask.get({ userId, taskId }) === undefined) return undefined;
      if ((countItems.get({ taskId }) ?? 0) >= maxItems) {
        throw conflict(`A checklist holds at most ${String(maxItems)} items`);
      }
      const position = keyBetween(lastItemPosition.get({ taskId }) ?? null, null);
      return insertItemStatement.get({ ...item, done: item.done ? 1 : 0, taskId, position });
    },
  );

  const moveItemAfter = db.transaction(
    (
      userId: string,
      taskId: string,
      itemId: string,
      afterId: string | null,
      keyBetween: KeyBetween,
      updatedAt: string,
    ): ItemRow | undefined => {
      const item = findItemStatement.get({ userId, taskId, itemId });
      const anchor =
        afterId === null ? null : findItemStatement.get({ userId, taskId, itemId: afterId });
      if (item === undefined || anchor === undefined) return undefined;
      const before = anchor?.position ?? null;
      const after = successorItemPosition.get({ taskId, itemId, before }) ?? null;
      return setItemPosition.get({ itemId, position: keyBetween(before, after), updatedAt });
    },
  );

  const updateItem = (
    userId: string,
    taskId: string,
    itemId: string,
    changes: UpdateChecklistItemInput,
    updatedAt: string,
  ): ItemRow | undefined => {
    if (findItemStatement.get({ userId, taskId, itemId }) === undefined) return undefined;
    const fields = Object.keys(changes)
      .filter(isItemUpdateField)
      .filter((key) => changes[key] !== undefined);
    const assignments = [
      ...fields.map((key) => `${ITEM_COLUMNS[key]} = @${key}`),
      'updated_at = @updatedAt',
    ];
    const done = changes.done === undefined ? {} : { done: changes.done ? 1 : 0 };
    return db
      .prepare<Record<string, unknown>, ItemRow>(
        `UPDATE checklist_items SET ${assignments.join(', ')} WHERE id = @itemId RETURNING *`,
      )
      .get({ ...changes, ...done, itemId, updatedAt });
  };

  return {
    listForUser: async (userId) => userItemsStatement.all({ userId }).map(toItem),
    listItems: async (userId, taskId) =>
      ownsTask.get({ userId, taskId }) === undefined
        ? undefined
        : listItemsStatement.all({ taskId }).map(toItem),
    insertItemAtBottom: async (userId, taskId, item, keyBetween, maxItems) =>
      optional(toItem)(
        guardPosition(() => insertItemAtBottom(userId, taskId, item, keyBetween, maxItems)),
      ),
    updateItem: async (userId, taskId, itemId, changes, updatedAt) =>
      optional(toItem)(updateItem(userId, taskId, itemId, changes, updatedAt)),
    removeItem: async (userId, taskId, itemId) =>
      deleteItemStatement.run({ userId, taskId, itemId }).changes > 0,
    moveItemAfter: async (userId, taskId, itemId, afterId, keyBetween, updatedAt) =>
      optional(toItem)(
        guardPosition(() => moveItemAfter(userId, taskId, itemId, afterId, keyBetween, updatedAt)),
      ),
  };
};

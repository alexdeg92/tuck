import { ChecklistItem, type UpdateChecklistItemInput } from '@todo/contracts';
import type pg from 'pg';
import {
  isUniqueViolation,
  lockForTransaction,
  withTransaction,
} from '../../../shared/db/postgres';
import { conflict } from '../../../shared/errors';
import type { KeyBetween } from '../../tasks/application';
import type { ChecklistRepository, NewChecklistItem } from '../application/ports';

type ItemRow = {
  id: string;
  task_id: string;
  text: string;
  notes: string;
  done: boolean;
  position: string;
  created_at: Date;
  updated_at: Date;
};

const toItem = (row: ItemRow): ChecklistItem =>
  ChecklistItem.parse({
    id: row.id,
    taskId: row.task_id,
    text: row.text,
    notes: row.notes,
    done: row.done,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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

const guardPosition = async <T>(write: Promise<T>): Promise<T> => {
  try {
    return await write;
  } catch (error) {
    if (isUniqueViolation(error, 'checklist_items_task_position_unique')) {
      throw conflict('The list changed while saving; please retry');
    }
    throw error;
  }
};

const ITEM_SELECT = `SELECT i.* FROM checklist_items i JOIN tasks t ON t.id = i.task_id
  WHERE i.id = $1 AND i.task_id = $2 AND t.user_id = $3 AND t.deleted_at IS NULL`;

type Db = pg.Pool | pg.PoolClient;

const setClause = (sets: [string, unknown][]): string =>
  sets.map(([column], index) => `${column} = $${String(index + 3)}`).join(', ');

export const makePostgresChecklistRepository = (pool: pg.Pool): ChecklistRepository => {
  const lockUser = (client: pg.PoolClient, userId: string) =>
    lockForTransaction(client, `tasks:${userId}`);

  const findItem = async (db: Db, userId: string, taskId: string, itemId: string) =>
    (await db.query<ItemRow>(ITEM_SELECT, [itemId, taskId, userId])).rows[0];

  const ownsTask = async (db: Db, userId: string, taskId: string): Promise<boolean> =>
    ((
      await db.query('SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [
        taskId,
        userId,
      ])
    ).rowCount ?? 0) > 0;

  const insertItemAtBottom = (
    userId: string,
    taskId: string,
    item: NewChecklistItem,
    keyBetween: KeyBetween,
    maxItems: number,
  ) =>
    withTransaction(pool, async (client) => {
      await lockUser(client, userId);

      const parent = await client.query(
        'SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR KEY SHARE',
        [taskId, userId],
      );
      if ((parent.rowCount ?? 0) === 0) return undefined;
      const counted = await client.query<{ total: number; last: string | null }>(
        'SELECT count(*)::int AS total, max(position) AS last FROM checklist_items WHERE task_id = $1',
        [taskId],
      );
      const { total = 0, last = null } = counted.rows[0] ?? {};
      if (total >= maxItems) throw conflict(`A checklist holds at most ${String(maxItems)} items`);
      const inserted = await client.query<ItemRow>(
        `INSERT INTO checklist_items (id, task_id, text, notes, done, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          item.id,
          taskId,
          item.text,
          item.notes,
          item.done,
          keyBetween(last, null),
          item.createdAt,
          item.updatedAt,
        ],
      );
      return inserted.rows[0];
    });

  const moveItemAfter = (
    userId: string,
    taskId: string,
    itemId: string,
    afterId: string | null,
    keyBetween: KeyBetween,
    updatedAt: string,
  ) =>
    withTransaction(pool, async (client) => {
      await lockUser(client, userId);
      const item = await findItem(client, userId, taskId, itemId);
      const anchor = afterId === null ? null : await findItem(client, userId, taskId, afterId);
      if (item === undefined || anchor === undefined) return undefined;
      const before = anchor?.position ?? null;
      const successor = await client.query<{ position: string }>(
        `SELECT position FROM checklist_items
         WHERE task_id = $1 AND id <> $2 AND ($3::text IS NULL OR position > $3)
         ORDER BY position LIMIT 1`,
        [taskId, itemId, before],
      );
      const moved = await client.query<ItemRow>(
        'UPDATE checklist_items SET position = $2, updated_at = $3 WHERE id = $1 RETURNING *',
        [itemId, keyBetween(before, successor.rows[0]?.position ?? null), updatedAt],
      );
      return moved.rows[0];
    });

  const updateItem = async (
    userId: string,
    taskId: string,
    itemId: string,
    changes: UpdateChecklistItemInput,
    updatedAt: string,
  ) => {
    if ((await findItem(pool, userId, taskId, itemId)) === undefined) return undefined;
    const sets: [string, unknown][] = [
      ...Object.keys(changes)
        .filter(isItemUpdateField)
        .filter((key) => changes[key] !== undefined)
        .map((key): [string, unknown] => [ITEM_COLUMNS[key], changes[key]]),
      ['updated_at', updatedAt],
    ];
    const updated = await pool.query<ItemRow>(
      `UPDATE checklist_items SET ${setClause(sets)} WHERE id = $1 AND task_id = $2 RETURNING *`,
      [itemId, taskId, ...sets.map(([, value]) => value)],
    );
    return updated.rows[0];
  };

  return {
    listForUser: async (userId) =>
      (
        await pool.query<ItemRow>(
          `SELECT i.* FROM checklist_items i JOIN tasks t ON t.id = i.task_id
           WHERE t.user_id = $1 AND t.deleted_at IS NULL ORDER BY i.task_id, i.position`,
          [userId],
        )
      ).rows.map(toItem),
    listItems: async (userId, taskId) => {
      if (!(await ownsTask(pool, userId, taskId))) return undefined;
      const listed = await pool.query<ItemRow>(
        'SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position',
        [taskId],
      );
      return listed.rows.map(toItem);
    },
    insertItemAtBottom: async (userId, taskId, item, keyBetween, maxItems) =>
      optional(toItem)(
        await guardPosition(insertItemAtBottom(userId, taskId, item, keyBetween, maxItems)),
      ),
    updateItem: async (userId, taskId, itemId, changes, updatedAt) =>
      optional(toItem)(await updateItem(userId, taskId, itemId, changes, updatedAt)),
    removeItem: async (userId, taskId, itemId) =>
      ((
        await pool.query(
          `DELETE FROM checklist_items
           WHERE id = $1 AND task_id = $2
             AND task_id IN (SELECT id FROM tasks WHERE user_id = $3 AND deleted_at IS NULL)`,
          [itemId, taskId, userId],
        )
      ).rowCount ?? 0) > 0,
    moveItemAfter: async (userId, taskId, itemId, afterId, keyBetween, updatedAt) =>
      optional(toItem)(
        await guardPosition(moveItemAfter(userId, taskId, itemId, afterId, keyBetween, updatedAt)),
      ),
  };
};

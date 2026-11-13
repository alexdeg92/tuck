import type { ChecklistItem, UpdateChecklistItemInput, UserId } from '@todo/contracts';
import {
  byPosition,
  itemsOfTask,
  type MemoryStore,
  ownedTask,
} from '../../../shared/db/memoryStore';
import { conflict } from '../../../shared/errors';
import type { ChecklistRepository } from '../application/ports';

const applyItemChanges = (
  item: ChecklistItem,
  changes: UpdateChecklistItemInput,
  updatedAt: string,
): ChecklistItem => ({
  ...item,
  text: changes.text ?? item.text,
  notes: changes.notes ?? item.notes,
  done: changes.done ?? item.done,
  updatedAt,
});

export const makeMemoryChecklistRepository = (store: MemoryStore): ChecklistRepository => {
  const { items } = store;
  const itemsOf = (taskId: string) => itemsOfTask(store, taskId);
  const owned = (userId: UserId, id: string) => ownedTask(store, userId, id);

  /** An item of this task, of this user's task; undefined otherwise. */
  const ownedItem = (userId: UserId, taskId: string, itemId: string): ChecklistItem | undefined => {
    const item = items.get(itemId);
    return item?.taskId === taskId && owned(userId, taskId) !== undefined ? item : undefined;
  };

  const saveItem = (item: ChecklistItem): ChecklistItem => {
    if (
      itemsOf(item.taskId).some((other) => other.id !== item.id && other.position === item.position)
    ) {
      throw conflict('The checklist changed while saving; please retry');
    }
    items.set(item.id, item);
    return { ...item };
  };

  return {
    listItems: async (userId, taskId) =>
      owned(userId, taskId) === undefined ? undefined : itemsOf(taskId),

    listForUser: async (userId) =>
      [...items.values()]
        .filter((item) => owned(userId, item.taskId) !== undefined)
        .sort((a, b) => (a.taskId === b.taskId ? byPosition(a, b) : a.taskId < b.taskId ? -1 : 1)),

    insertItemAtBottom: async (userId, taskId, item, keyBetween, maxItems) => {
      if (owned(userId, taskId) === undefined) return undefined;
      const checklist = itemsOf(taskId);
      if (checklist.length >= maxItems) {
        throw conflict(`A checklist holds at most ${String(maxItems)} items`);
      }
      const last = checklist.at(-1)?.position ?? null;
      return saveItem({ ...item, taskId, position: keyBetween(last, null) });
    },

    updateItem: async (userId, taskId, itemId, changes, updatedAt) => {
      const item = ownedItem(userId, taskId, itemId);
      return item === undefined ? undefined : saveItem(applyItemChanges(item, changes, updatedAt));
    },

    removeItem: async (userId, taskId, itemId) =>
      ownedItem(userId, taskId, itemId) !== undefined && items.delete(itemId),

    moveItemAfter: async (userId, taskId, itemId, afterId, keyBetween, updatedAt) => {
      const item = ownedItem(userId, taskId, itemId);
      const anchor = afterId === null ? null : ownedItem(userId, taskId, afterId);
      if (item === undefined || anchor === undefined) return undefined;
      const before = anchor?.position ?? null;
      const after =
        itemsOf(taskId).find(
          (other) => other.id !== itemId && (before === null || other.position > before),
        )?.position ?? null;
      return saveItem({ ...item, position: keyBetween(before, after), updatedAt });
    },
  };
};

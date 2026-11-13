import type { ChecklistItem, NoteDoc, Task, UserId } from '@todo/contracts';

export type StoredTask = Omit<Task, 'checklist'> & {
  deletedAt: string | null;

  notesDoc?: NoteDoc | null | undefined;
};

export type MemoryStore = {
  tasks: Map<string, { userId: UserId; task: StoredTask }>;
  items: Map<string, ChecklistItem>;
};

export const makeMemoryStore = (): MemoryStore => ({ tasks: new Map(), items: new Map() });

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const byPosition = <T extends { position: string }>(a: T, b: T): number =>
  compare(a.position, b.position);

export const itemsOfTask = (store: MemoryStore, taskId: string): ChecklistItem[] =>
  [...store.items.values()].filter((item) => item.taskId === taskId).sort(byPosition);

export const ownedTaskInOrOutOfTrash = (
  store: MemoryStore,
  userId: UserId,
  id: string,
): StoredTask | undefined => {
  const row = store.tasks.get(id);
  return row?.userId === userId ? row.task : undefined;
};

export const ownedTask = (
  store: MemoryStore,
  userId: UserId,
  id: string,
): StoredTask | undefined => {
  const task = ownedTaskInOrOutOfTrash(store, userId, id);
  return task?.deletedAt === null ? task : undefined;
};

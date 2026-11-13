import type { Task, UserId } from '@todo/contracts';
import {
  byPosition,
  itemsOfTask,
  makeMemoryStore,
  type MemoryStore,
  ownedTask,
  ownedTaskInOrOutOfTrash,
  type StoredTask,
} from '../../../shared/db/memoryStore';
import { conflict, staleTask } from '../../../shared/errors';
import { nextUpdatedAt } from '../domain/version';
import type {
  DeletedTask,
  StoredTask as TaskWithDoc,
  TaskEdit,
  TaskRepository,
} from '../application/ports';
import { completedAtAfter } from '../domain/completion';

const applyChanges = (task: StoredTask, changes: TaskEdit, updatedAt: string): StoredTask => ({
  ...task,
  notesDoc: changes.notesDoc === undefined ? task.notesDoc : changes.notesDoc,
  title: changes.title ?? task.title,
  notes: changes.notes ?? task.notes,
  status: changes.status ?? task.status,
  priority: changes.priority ?? task.priority,
  dueDate: changes.dueDate === undefined ? task.dueDate : changes.dueDate,
  completedAt:
    changes.status === undefined
      ? task.completedAt
      : completedAtAfter(task, changes.status, updatedAt),
  updatedAt,
});

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const listOrder = (a: StoredTask, b: StoredTask): number => {
  const aDone = a.status === 'done';
  const bDone = b.status === 'done';
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (!aDone) return byPosition(a, b);
  return compare(b.completedAt ?? '', a.completedAt ?? '') || compare(a.id, b.id);
};

export const makeMemoryTaskRepository = (
  store: MemoryStore = makeMemoryStore(),
): TaskRepository => {
  const rows = store.tasks;
  const itemsOf = (taskId: string) => itemsOfTask(store, taskId);
  const owned = (userId: UserId, id: string) => ownedTask(store, userId, id);
  const ownedAny = (userId: UserId, id: string) => ownedTaskInOrOutOfTrash(store, userId, id);

  const withSummary = ({ deletedAt: _trash, notesDoc: _doc, ...task }: StoredTask): Task => {
    const checklist = itemsOf(task.id);
    return {
      ...task,
      checklist: { done: checklist.filter(({ done }) => done).length, total: checklist.length },
    };
  };

  const withDoc = (task: StoredTask): TaskWithDoc => ({
    ...withSummary(task),
    notesDoc: task.notesDoc ?? null,
  });

  const asDeleted = (task: StoredTask, deletedAt: string): DeletedTask => ({
    ...withSummary(task),
    deletedAt,
  });

  const storedOf = (userId: UserId): StoredTask[] =>
    [...rows.values()]
      .filter((row) => row.userId === userId)
      .map(({ task }) => task)
      .sort(byPosition);

  const listed = (userId: UserId): Task[] =>
    storedOf(userId)
      .filter(({ deletedAt }) => deletedAt === null)
      .sort(listOrder)
      .map(withSummary);

  const trashedOf = (userId: UserId): (StoredTask & { deletedAt: string })[] =>
    storedOf(userId).filter(
      (task): task is StoredTask & { deletedAt: string } => task.deletedAt !== null,
    );

  const deleteWithItems = (id: string): boolean => {
    itemsOf(id).forEach((item) => store.items.delete(item.id));
    return rows.delete(id);
  };

  const save = (userId: UserId, task: StoredTask): Task => {
    if (
      storedOf(userId).some((other) => other.id !== task.id && other.position === task.position)
    ) {
      throw conflict('The list changed while saving; please retry');
    }
    rows.set(task.id, { userId, task });
    return withSummary(task);
  };

  return {
    list: async (userId) => listed(userId),

    findById: async (userId, id) => {
      const task = owned(userId, id);
      return task === undefined ? undefined : withDoc(task);
    },

    insertAtTop: async (userId, task, keyBetween) => {
      const first = storedOf(userId)[0]?.position ?? null;
      return save(userId, { ...task, deletedAt: null, position: keyBetween(null, first) });
    },

    update: async (userId, id, changes, updatedAt, expectedUpdatedAt) => {
      const task = owned(userId, id);
      if (task === undefined) return undefined;

      if (expectedUpdatedAt !== undefined && task.updatedAt !== expectedUpdatedAt) {
        throw staleTask(withDoc(task));
      }
      const changed = applyChanges(task, changes, nextUpdatedAt(task.updatedAt, updatedAt));
      save(userId, changed);
      return withDoc(changed);
    },

    moveAfter: async (userId, id, afterId, keyBetween, updatedAt) => {
      const task = owned(userId, id);
      const anchor = afterId === null ? null : owned(userId, afterId);
      if (task === undefined || anchor === undefined) return undefined;
      const before = anchor?.position ?? null;
      const after =
        storedOf(userId).find(
          (other) => other.id !== id && (before === null || other.position > before),
        )?.position ?? null;
      return save(userId, {
        ...task,
        position: keyBetween(before, after),
        updatedAt: nextUpdatedAt(task.updatedAt, updatedAt),
      });
    },

    trash: async (userId, id, deletedAt) => {
      const task = ownedAny(userId, id);
      if (task === undefined) return undefined;
      const trashed = { ...task, deletedAt: task.deletedAt ?? deletedAt };
      rows.set(id, { userId, task: trashed });
      return asDeleted(trashed, trashed.deletedAt);
    },

    listTrash: async (userId) =>
      trashedOf(userId)
        .sort((a, b) => compare(b.deletedAt, a.deletedAt) || compare(a.id, b.id))
        .map((task) => asDeleted(task, task.deletedAt)),

    restore: async (userId, id) => {
      const task = ownedAny(userId, id);
      if (task === undefined) return undefined;
      rows.set(id, { userId, task: { ...task, deletedAt: null } });
      return withSummary(task);
    },

    deleteForever: async (userId, id) =>
      trashedOf(userId).some((task) => task.id === id) && deleteWithItems(id),

    emptyTrash: async (userId) => trashedOf(userId).filter(({ id }) => deleteWithItems(id)).length,

    purgeDeletedBefore: async (cutoff) =>
      [...rows.values()]
        .filter(({ task }) => task.deletedAt !== null && task.deletedAt <= cutoff)
        .filter(({ task }) => deleteWithItems(task.id)).length,
  };
};

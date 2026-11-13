import type { NoteDoc, Task, TaskChanges, TaskId, TrashedTask, UserId } from '@todo/contracts';
import type { KeyBetween } from '../domain/ordering';

export type NewTask = Omit<Task, 'position' | 'checklist'>;

export type StoredTask = Task & { notesDoc: NoteDoc | null };

export type TaskEdit = Omit<TaskChanges, 'notesDoc'> & { notesDoc?: NoteDoc | null };

export type DeletedTask = Omit<TrashedTask, 'purgeAt'>;

/**
 * Persistence port for tasks. Every method is scoped by the owner: another user's task behaves
 * exactly like a missing one (undefined / false). Absence is `undefined`, never null; the use
 * case turns it into a NOT_FOUND domain error. `update` decides completedAt from the stored status
 * with completedAtAfter in the same atomic step as the write, so a racing toggle can't restore a
 * stale stamp. Inserts and moves read the neighbours and write the new position atomically, and
 * reject a position collision with a CONFLICT app error.
 *
 * The trash: a trashed task (deletedAt set) is missing for every method except the trash ones,
 * and for the checklists module too. It keeps its position, so new keys are still computed around
 * it and a restore never collides. Deleting a task for good deletes its checklist.
 */
export type TaskRepository = {
  list: (userId: UserId) => Promise<Task[]>;
  findById: (userId: UserId, id: TaskId) => Promise<StoredTask | undefined>;
  insertAtTop: (userId: UserId, task: NewTask, keyBetween: KeyBetween) => Promise<Task>;
  update: (
    userId: UserId,
    id: TaskId,
    changes: TaskEdit,

    updatedAt: string,
    /**
     * Precondition: when set, write only if the stored updatedAt still equals it, checked in the
     * same atomic step as the write; otherwise reject with staleTask(current) and write nothing.
     */
    expectedUpdatedAt?: string,
  ) => Promise<StoredTask | undefined>;
  moveAfter: (
    userId: UserId,
    id: TaskId,
    afterId: TaskId | null,
    keyBetween: KeyBetween,
    updatedAt: string,
  ) => Promise<Task | undefined>;

  trash: (userId: UserId, id: TaskId, deletedAt: string) => Promise<DeletedTask | undefined>;

  listTrash: (userId: UserId) => Promise<DeletedTask[]>;

  restore: (userId: UserId, id: TaskId) => Promise<Task | undefined>;

  deleteForever: (userId: UserId, id: TaskId) => Promise<boolean>;

  emptyTrash: (userId: UserId) => Promise<number>;

  purgeDeletedBefore: (cutoff: string) => Promise<number>;
};

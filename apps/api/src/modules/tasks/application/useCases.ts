import {
  type CreateTaskInput,
  type ListTasksQuery,
  type MoveTaskInput,
  projectNote,
  type Task,
  type TaskChanges,
  type TaskDetail,
  type TaskId,
  type TaskList,
  type UpdateTaskInput,
  type UserId,
} from '@todo/contracts';
import { isStaleTaskError, notFound, staleTask, validationFailed } from '../../../shared/errors';
import { detailOf, normaliseNote } from '../../notes/application';
import { matchesFilter } from '../domain/listFilter';
import type { KeyBetween } from '../domain/ordering';
import type { TaskEdit, TaskRepository } from './ports';
import { retryOnceOnConflict } from './retryOnceOnConflict';

type Deps = {
  tasks: TaskRepository;
  clock: () => Date;
  ids: () => string;
  keyBetween: KeyBetween;
};

const found = <T>(value: T | undefined): T => {
  if (value === undefined) throw notFound('Task not found');
  return value;
};

export const makeListTasks =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId, { q }: ListTasksQuery): Promise<TaskList> => {
    const items = await tasks.list(userId);
    return { items: q === '' ? items : items.filter((task) => matchesFilter(task, q)) };
  };

export const makeTasksOfUser =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  (userId: UserId): Promise<Task[]> =>
    tasks.list(userId);

export const makeCreateTask =
  ({ tasks, clock, ids, keyBetween }: Deps) =>
  (userId: UserId, input: CreateTaskInput): Promise<Task> => {
    const now = clock().toISOString();
    const task = {
      id: ids(),
      ...input,
      status: 'todo' as const,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    return retryOnceOnConflict(() => tasks.insertAtTop(userId, task, keyBetween));
  };

export const makeGetTask =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId, id: TaskId): Promise<TaskDetail> => {
    const stored = found(await tasks.findById(userId, id));
    return detailOf(stored, stored.notesDoc);
  };

const editOf = ({ notesDoc, ...changes }: TaskChanges): TaskEdit => {
  if (notesDoc !== undefined) {
    const doc = normaliseNote(notesDoc);
    return { ...changes, notes: projectNote(doc).text, notesDoc: doc };
  }
  return changes.notes === undefined ? changes : { ...changes, notesDoc: null };
};

export const makeUpdateTask =
  ({ tasks, clock }: Pick<Deps, 'tasks' | 'clock'>) =>
  async (
    userId: UserId,
    id: TaskId,
    { expectedUpdatedAt, ...changes }: UpdateTaskInput,
  ): Promise<TaskDetail> => {
    try {
      const stored = found(
        await tasks.update(userId, id, editOf(changes), clock().toISOString(), expectedUpdatedAt),
      );
      return detailOf(stored, stored.notesDoc);
    } catch (error) {
      if (isStaleTaskError(error)) {
        throw staleTask(detailOf(error.current, error.current.notesDoc ?? null));
      }
      throw error;
    }
  };

export const makeMoveTask =
  ({ tasks, clock, keyBetween }: Pick<Deps, 'tasks' | 'clock' | 'keyBetween'>) =>
  async (userId: UserId, id: TaskId, { afterId }: MoveTaskInput): Promise<Task> => {
    if (afterId === id) throw validationFailed('A task cannot be moved after itself');

    if (found(await tasks.findById(userId, id)).status === 'done') {
      throw validationFailed('A completed task cannot be reordered');
    }
    const anchor = afterId === null ? null : await tasks.findById(userId, afterId);
    if (anchor?.status === 'done') {
      throw validationFailed('A task can only be placed after an open task');
    }
    const updatedAt = clock().toISOString();
    return found(
      await retryOnceOnConflict(() => tasks.moveAfter(userId, id, afterId, keyBetween, updatedAt)),
    );
  };

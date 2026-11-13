import type { Task, TaskId, TrashedTask, TrashList, UserId } from '@todo/contracts';
import { notFound } from '../../../shared/errors';
import { purgeAtOf, purgeCutoff } from '../domain/trash';
import type { DeletedTask, TaskRepository } from './ports';

type Deps = { tasks: TaskRepository; clock: () => Date };

const found = <T>(value: T | undefined): T => {
  if (value === undefined) throw notFound('Task not found');
  return value;
};

const withPurgeAt = (task: DeletedTask): TrashedTask => ({
  ...task,
  purgeAt: purgeAtOf(task.deletedAt),
});

export const makeTrashTask =
  ({ tasks, clock }: Deps) =>
  async (userId: UserId, id: TaskId): Promise<TrashedTask> =>
    withPurgeAt(found(await tasks.trash(userId, id, clock().toISOString())));

export const makeListTrash =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId): Promise<TrashList> => ({
    items: (await tasks.listTrash(userId)).map(withPurgeAt),
  });

export const makeRestoreTask =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId, id: TaskId): Promise<Task> =>
    found(await tasks.restore(userId, id));

export const makeDeleteForever =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId, id: TaskId): Promise<void> => {
    if (!(await tasks.deleteForever(userId, id))) throw notFound('Task not found in the trash');
  };

export const makeEmptyTrash =
  ({ tasks }: Pick<Deps, 'tasks'>) =>
  async (userId: UserId): Promise<void> => {
    await tasks.emptyTrash(userId);
  };

export const makePurgeTrash =
  ({ tasks, clock }: Deps) =>
  (): Promise<number> =>
    tasks.purgeDeletedBefore(purgeCutoff(clock()));

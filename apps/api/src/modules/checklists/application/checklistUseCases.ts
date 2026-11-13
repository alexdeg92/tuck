import type {
  Checklist,
  ChecklistItem,
  ChecklistItemId,
  CreateChecklistItemInput,
  MoveChecklistItemInput,
  TaskId,
  UpdateChecklistItemInput,
  UserId,
} from '@todo/contracts';
import { notFound, validationFailed } from '../../../shared/errors';
import { CHECKLIST_LIMIT } from '../domain/checklist';
import { type KeyBetween, retryOnceOnConflict } from '../../tasks/application';
import type { ChecklistRepository } from './ports';

type Deps = {
  checklists: ChecklistRepository;
  clock: () => Date;
  ids: () => string;
  keyBetween: KeyBetween;
};

const taskFound = <T>(value: T | undefined): T => {
  if (value === undefined) throw notFound('Task not found');
  return value;
};

const itemFound = <T>(value: T | undefined): T => {
  if (value === undefined) throw notFound('Checklist item not found');
  return value;
};

export const makeListChecklist =
  ({ checklists }: Pick<Deps, 'checklists'>) =>
  async (userId: UserId, taskId: TaskId): Promise<Checklist> => ({
    items: taskFound(await checklists.listItems(userId, taskId)),
  });

export const makeAddChecklistItem =
  ({ checklists, clock, ids, keyBetween }: Deps) =>
  async (
    userId: UserId,
    taskId: TaskId,
    input: CreateChecklistItemInput,
  ): Promise<ChecklistItem> => {
    const now = clock().toISOString();
    const item = { id: ids(), ...input, done: false, createdAt: now, updatedAt: now };
    return taskFound(
      await retryOnceOnConflict(() =>
        checklists.insertItemAtBottom(userId, taskId, item, keyBetween, CHECKLIST_LIMIT),
      ),
    );
  };

export const makeUpdateChecklistItem =
  ({ checklists, clock }: Pick<Deps, 'checklists' | 'clock'>) =>
  async (
    userId: UserId,
    taskId: TaskId,
    itemId: ChecklistItemId,
    changes: UpdateChecklistItemInput,
  ): Promise<ChecklistItem> =>
    itemFound(await checklists.updateItem(userId, taskId, itemId, changes, clock().toISOString()));

export const makeDeleteChecklistItem =
  ({ checklists }: Pick<Deps, 'checklists'>) =>
  async (userId: UserId, taskId: TaskId, itemId: ChecklistItemId): Promise<void> => {
    if (!(await checklists.removeItem(userId, taskId, itemId)))
      throw notFound('Checklist item not found');
  };

export const makeMoveChecklistItem =
  ({ checklists, clock, keyBetween }: Pick<Deps, 'checklists' | 'clock' | 'keyBetween'>) =>
  async (
    userId: UserId,
    taskId: TaskId,
    itemId: ChecklistItemId,
    { afterId }: MoveChecklistItemInput,
  ): Promise<ChecklistItem> => {
    if (afterId === itemId) throw validationFailed('An item cannot be moved after itself');
    const updatedAt = clock().toISOString();
    return itemFound(
      await retryOnceOnConflict(() =>
        checklists.moveItemAfter(userId, taskId, itemId, afterId, keyBetween, updatedAt),
      ),
    );
  };

export const makeItemsOfUser =
  ({ checklists }: Pick<Deps, 'checklists'>) =>
  (userId: UserId): Promise<ChecklistItem[]> =>
    checklists.listForUser(userId);

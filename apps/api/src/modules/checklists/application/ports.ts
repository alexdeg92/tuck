import type {
  ChecklistItem,
  ChecklistItemId,
  TaskId,
  UpdateChecklistItemInput,
  UserId,
} from '@todo/contracts';
import type { KeyBetween } from '../../tasks/application';

export type NewChecklistItem = Omit<ChecklistItem, 'position' | 'taskId'>;

export type ChecklistRepository = {
  listItems: (userId: UserId, taskId: TaskId) => Promise<ChecklistItem[] | undefined>;

  listForUser: (userId: UserId) => Promise<ChecklistItem[]>;

  insertItemAtBottom: (
    userId: UserId,
    taskId: TaskId,
    item: NewChecklistItem,
    keyBetween: KeyBetween,
    maxItems: number,
  ) => Promise<ChecklistItem | undefined>;
  updateItem: (
    userId: UserId,
    taskId: TaskId,
    itemId: ChecklistItemId,
    changes: UpdateChecklistItemInput,
    updatedAt: string,
  ) => Promise<ChecklistItem | undefined>;
  removeItem: (userId: UserId, taskId: TaskId, itemId: ChecklistItemId) => Promise<boolean>;
  moveItemAfter: (
    userId: UserId,
    taskId: TaskId,
    itemId: ChecklistItemId,
    afterId: ChecklistItemId | null,
    keyBetween: KeyBetween,
    updatedAt: string,
  ) => Promise<ChecklistItem | undefined>;
};

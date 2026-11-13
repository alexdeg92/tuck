import type { ChecklistItem, Task, UserId } from '@todo/contracts';

export type SearchSources = {
  tasksOf: (userId: UserId) => Promise<Task[]>;

  itemsOf: (userId: UserId) => Promise<ChecklistItem[]>;
};

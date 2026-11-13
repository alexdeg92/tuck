import type { Task, TaskStatus } from '@todo/contracts';

export const completedAtAfter = (
  task: Pick<Task, 'status' | 'completedAt'>,
  status: TaskStatus,
  now: string,
): string | null => {
  if (status === 'todo') return null;
  return task.status === 'done' ? task.completedAt : now;
};

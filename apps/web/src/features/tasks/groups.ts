import type { Task } from '@todo/contracts';

export function splitByStatus(items: Task[]): { open: Task[]; done: Task[] } {
  return {
    open: items.filter((task) => task.status !== 'done'),
    done: items.filter((task) => task.status === 'done'),
  };
}

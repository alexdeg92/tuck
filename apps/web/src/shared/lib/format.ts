import type { TaskPriority } from '@todo/contracts';

const dueFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isDueDateOverdue(dueDate: string, today = utcDay()): boolean {
  return dueDate < today;
}

export function formatDueDate(dueDate: string | null, today = utcDay()): string | null {
  if (dueDate === null) return null;
  const parts = dueDate.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return null;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (year < 1 || month < 1 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const formatted = dueFormatter.format(date);
  if (isDueDateOverdue(dueDate, today)) return `Overdue · ${formatted}`;
  return `Due ${formatted}`;
}

export function formatPriority(priority: TaskPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

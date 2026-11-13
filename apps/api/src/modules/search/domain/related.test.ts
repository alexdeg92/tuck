import type { ChecklistItem, Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { relatedTasks } from './related';

const NOW = '2026-11-11T09:30:00.000Z';

const task = (title: string, notes = ''): Task => ({
  id: crypto.randomUUID(),
  title,
  notes,
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  position: 'a0',
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  checklist: { done: 0, total: 0 },
});

const titlesRelatedTo = (target: Task, tasks: Task[], items: ChecklistItem[] = []) =>
  relatedTasks({ tasks, items }, target.id).map(({ title }) => title);

describe('relatedTasks (TF-IDF cosine over the user’s tasks)', () => {
  it('ranks a task sharing a rare word above one sharing a common word, and never the task itself', () => {
    const target = task('Quarterly budget review with the team');
    const tasks = [
      target,
      task('Prepare the quarterly report'),
      task('Team lunch'),
      task('Team standup'),
      task('Team retro'),
    ];

    const related = titlesRelatedTo(target, tasks);

    expect(related[0]).toBe('Prepare the quarterly report');
    expect(related).not.toContain(target.title);
  });

  it('counts checklist items as part of a task', () => {
    const target = task('Groceries');
    const other = task('Breakfast');
    const items: ChecklistItem[] = [target, other].map((owner) => ({
      id: crypto.randomUUID(),
      taskId: owner.id,
      text: 'Sourdough croissants',
      notes: '',
      done: false,
      position: 'a0',
      createdAt: NOW,
      updatedAt: NOW,
    }));

    expect(titlesRelatedTo(target, [target, other, task('Taxes')], items)).toEqual(['Breakfast']);
  });

  it('returns at most 3, and none when nothing shares a word', () => {
    const target = task('Renew passport photos');
    const similar = Array.from({ length: 5 }, (_, index) =>
      task(`Passport photos ${String(index)}`),
    );

    expect(titlesRelatedTo(target, [target, ...similar])).toHaveLength(3);
    expect(titlesRelatedTo(target, [target, task('Water the plants')])).toEqual([]);
  });

  it('returns nothing for an unknown task or an empty corpus', () => {
    expect(relatedTasks({ tasks: [], items: [] }, crypto.randomUUID())).toEqual([]);
  });
});

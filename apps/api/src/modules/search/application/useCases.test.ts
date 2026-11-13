import { describe, expect, it } from 'vitest';
import { makeMemoryStore } from '../../../shared/db/memoryStore';
import { makeItemsOfUser } from '../../checklists/application';
import { makeMemoryChecklistRepository } from '../../checklists/infrastructure/memoryChecklistRepository';
import { keyBetween, makeCreateTask, makeTasksOfUser } from '../../tasks/application';
import { makeMemoryTaskRepository } from '../../tasks/infrastructure/memoryTaskRepository';
import { makeRelatedTasks, makeSearchTasks } from './useCases';

const USER = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
const STRANGER = '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e';
const NOW = new Date('2026-11-11T09:30:00.000Z');

const setup = () => {
  const store = makeMemoryStore();
  const tasks = makeMemoryTaskRepository(store);
  const checklists = makeMemoryChecklistRepository(store);
  const deps = { tasks, checklists, clock: () => NOW, ids: () => crypto.randomUUID(), keyBetween };
  return {
    createTask: makeCreateTask(deps),
    sources: { tasksOf: makeTasksOfUser(deps), itemsOf: makeItemsOfUser(deps) },
  };
};

const input = (title: string) => ({ title, notes: '', priority: 'medium' as const, dueDate: null });

describe('search use cases', () => {
  it("searches the user's own tasks and checklist items, with typo tolerance", async () => {
    const { createTask, sources } = setup();
    const searchTasks = makeSearchTasks(sources);
    await createTask(USER, input('Groceries'));
    await createTask(STRANGER, input('Groceries for someone else'));

    const result = await searchTasks(USER, { q: 'grocries' });

    expect(result).toMatchObject({ mode: 'fuzzy', suggestion: { text: 'Groceries' } });
    expect(result.hits.map(({ task }) => task.title)).toEqual(['Groceries']);
  });

  it('relates tasks that share unusual words, and reports a foreign task as NOT_FOUND', async () => {
    const { createTask, sources } = setup();
    const relatedTasks = makeRelatedTasks(sources);
    const budget = await createTask(USER, input('Quarterly budget'));
    await createTask(USER, input('Quarterly report'));
    await createTask(USER, input('Water the plants'));

    expect((await relatedTasks(USER, budget.id)).items.map(({ title }) => title)).toEqual([
      'Quarterly report',
    ]);
    await expect(relatedTasks(STRANGER, budget.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

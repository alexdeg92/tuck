import { describe, expect, it, vi } from 'vitest';
import { makeMemoryStore } from '../../../shared/db/memoryStore';
import { keyBetween, makeCreateTask } from '../../tasks/application';
import { makeMemoryTaskRepository } from '../../tasks/infrastructure/memoryTaskRepository';
import { CHECKLIST_LIMIT } from '../domain/checklist';
import { makeMemoryChecklistRepository } from '../infrastructure/memoryChecklistRepository';
import {
  makeAddChecklistItem,
  makeDeleteChecklistItem,
  makeListChecklist,
  makeMoveChecklistItem,
  makeUpdateChecklistItem,
} from './checklistUseCases';

const USER = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
const STRANGER = '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e';
const NOW = new Date('2026-11-11T09:30:00.000Z');

const setup = async () => {
  const store = makeMemoryStore();
  const tasks = makeMemoryTaskRepository(store);
  const checklists = makeMemoryChecklistRepository(store);
  const keys = vi.fn(keyBetween);
  const deps = {
    tasks,
    checklists,
    clock: () => NOW,
    ids: () => crypto.randomUUID(),
    keyBetween: keys,
  };
  const task = await makeCreateTask(deps)(USER, {
    title: 'Groceries',
    notes: '',
    priority: 'medium',
    dueDate: null,
  });
  return {
    keys,
    task,
    listChecklist: makeListChecklist(deps),
    addItem: makeAddChecklistItem(deps),
    updateItem: makeUpdateChecklistItem(deps),
    deleteItem: makeDeleteChecklistItem(deps),
    moveItem: makeMoveChecklistItem(deps),
  };
};

describe('checklist use cases', () => {
  it('adds a not-done item with server-owned id, position and timestamps', async () => {
    const { task, addItem, listChecklist } = await setup();

    const item = await addItem(USER, task.id, { text: 'Oat milk', notes: '' });

    expect(item).toMatchObject({
      taskId: task.id,
      text: 'Oat milk',
      done: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(await listChecklist(USER, task.id)).toEqual({ items: [item] });
  });

  it("reports another user's task as NOT_FOUND", async () => {
    const { task, listChecklist, addItem } = await setup();
    const notFound = { code: 'NOT_FOUND', message: 'Task not found' };

    await expect(listChecklist(STRANGER, task.id)).rejects.toMatchObject(notFound);
    await expect(addItem(STRANGER, task.id, { text: 'x', notes: '' })).rejects.toMatchObject(
      notFound,
    );
  });

  it(`refuses item number ${String(CHECKLIST_LIMIT + 1)} with CONFLICT`, async () => {
    const { task, addItem } = await setup();
    for (let index = 0; index < CHECKLIST_LIMIT; index += 1) {
      await addItem(USER, task.id, { text: `Item ${String(index)}`, notes: '' });
    }

    await expect(addItem(USER, task.id, { text: 'One too many', notes: '' })).rejects.toMatchObject(
      {
        code: 'CONFLICT',
        message: `A checklist holds at most ${String(CHECKLIST_LIMIT)} items`,
      },
    );
  });

  it('reports a missing item as NOT_FOUND for update, delete and move', async () => {
    const { task, updateItem, deleteItem, moveItem } = await setup();
    const missing = crypto.randomUUID();
    const notFound = { code: 'NOT_FOUND', message: 'Checklist item not found' };

    await expect(updateItem(USER, task.id, missing, { done: true })).rejects.toMatchObject(
      notFound,
    );
    await expect(deleteItem(USER, task.id, missing)).rejects.toMatchObject(notFound);
    await expect(moveItem(USER, task.id, missing, { afterId: null })).rejects.toMatchObject(
      notFound,
    );
  });

  it('toggles, edits and deletes an item', async () => {
    const { task, addItem, updateItem, deleteItem, listChecklist } = await setup();
    const item = await addItem(USER, task.id, { text: 'Eggs', notes: '' });

    expect(await updateItem(USER, task.id, item.id, { done: true, notes: 'six' })).toMatchObject({
      done: true,
      notes: 'six',
    });
    await deleteItem(USER, task.id, item.id);
    expect(await listChecklist(USER, task.id)).toEqual({ items: [] });
  });

  it('refuses to move an item after itself', async () => {
    const { task, addItem, moveItem } = await setup();
    const item = await addItem(USER, task.id, { text: 'Eggs', notes: '' });

    await expect(moveItem(USER, task.id, item.id, { afterId: item.id })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('gives up on a move after one retry with CONFLICT', async () => {
    const { task, addItem, moveItem, keys } = await setup();
    const a = await addItem(USER, task.id, { text: 'A', notes: '' });
    const b = await addItem(USER, task.id, { text: 'B', notes: '' });
    const c = await addItem(USER, task.id, { text: 'C', notes: '' });
    keys.mockClear().mockImplementation(() => b.position);

    await expect(moveItem(USER, task.id, a.id, { afterId: c.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(keys).toHaveBeenCalledTimes(2);
  });
});

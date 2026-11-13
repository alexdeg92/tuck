import { fromPlainText } from '@todo/contracts';
import { describe, expect, it, vi } from 'vitest';
import { keyBetween } from '../domain/ordering';
import { makeMemoryTaskRepository } from '../infrastructure/memoryTaskRepository';
import {
  makeCreateTask,
  makeGetTask,
  makeListTasks,
  makeMoveTask,
  makeUpdateTask,
} from './useCases';
import { makeTrashTask } from './trashUseCases';

const USER = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
const STRANGER = '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e';
const NOW = new Date('2026-11-11T09:30:00.000Z');

const setup = () => {
  const tasks = makeMemoryTaskRepository();
  const keys = vi.fn(keyBetween);
  const deps = { tasks, clock: () => NOW, ids: () => crypto.randomUUID(), keyBetween: keys };
  return {
    keys,
    listTasks: makeListTasks(deps),
    createTask: makeCreateTask(deps),
    getTask: makeGetTask(deps),
    updateTask: makeUpdateTask(deps),
    deleteTask: makeTrashTask(deps),
    moveTask: makeMoveTask(deps),
  };
};

const input = (title: string) => ({ title, notes: '', priority: 'medium' as const, dueDate: null });

describe('task use cases', () => {
  it('creates a todo task at the top with server-owned id, position and timestamps', async () => {
    const { createTask, listTasks } = setup();
    const first = await createTask(USER, input('First'));
    const second = await createTask(USER, input('Second'));

    expect(second).toMatchObject({
      title: 'Second',
      status: 'todo',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(await listTasks(USER, { q: '' })).toEqual({ items: [second, first] });
  });

  it('filters the list with the query', async () => {
    const { createTask, listTasks } = setup();
    await createTask(USER, input('Buy milk'));
    await createTask(USER, input('Call mum'));

    expect((await listTasks(USER, { q: 'milk' })).items.map(({ title }) => title)).toEqual([
      'Buy milk',
    ]);
  });

  it('reports a missing or foreign task as NOT_FOUND for get, update and delete', async () => {
    const { createTask, getTask, updateTask, deleteTask } = setup();
    const task = await createTask(USER, input('Mine'));

    await expect(getTask(STRANGER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(updateTask(STRANGER, task.id, { title: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteTask(STRANGER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await getTask(USER, task.id)).toEqual({ ...task, notesDoc: fromPlainText(task.notes) });
  });

  it('updates and trashes the owner’s task', async () => {
    const { createTask, getTask, updateTask, deleteTask } = setup();
    const task = await createTask(USER, input('Mine'));

    expect(await updateTask(USER, task.id, { status: 'done' })).toMatchObject({ status: 'done' });
    await deleteTask(USER, task.id);
    await expect(getTask(USER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('completion', () => {
    it('stamps completedAt when a task is done, keeps it on later edits, clears it on reopen', async () => {
      const clock = { now: NOW };
      const tasks = makeMemoryTaskRepository();
      const deps = { tasks, clock: () => clock.now, ids: () => crypto.randomUUID(), keyBetween };
      const createTask = makeCreateTask(deps);
      const updateTask = makeUpdateTask(deps);
      const task = await createTask(USER, input('Report'));
      expect(task.completedAt).toBeNull();

      clock.now = new Date('2026-11-12T08:00:00.000Z');
      expect((await updateTask(USER, task.id, { status: 'done' })).completedAt).toBe(
        '2026-11-12T08:00:00.000Z',
      );
      clock.now = new Date('2026-11-13T08:00:00.000Z');
      expect((await updateTask(USER, task.id, { title: 'Report v2' })).completedAt).toBe(
        '2026-11-12T08:00:00.000Z',
      );
      expect((await updateTask(USER, task.id, { status: 'done' })).completedAt).toBe(
        '2026-11-12T08:00:00.000Z',
      );
      expect((await updateTask(USER, task.id, { status: 'todo' })).completedAt).toBeNull();
    });

    it('refuses to move a done task, or to place a task after a done one', async () => {
      const { createTask, updateTask, moveTask } = setup();
      const open = await createTask(USER, input('Open'));
      const done = await createTask(USER, input('Done'));
      await updateTask(USER, done.id, { status: 'done' });

      await expect(moveTask(USER, done.id, { afterId: null })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'A completed task cannot be reordered',
      });
      await expect(moveTask(USER, open.id, { afterId: done.id })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: 'A task can only be placed after an open task',
      });
    });
  });

  describe('moveTask', () => {
    it('moves after an anchor', async () => {
      const { createTask, moveTask, listTasks } = setup();
      const b = await createTask(USER, input('B'));
      const a = await createTask(USER, input('A'));

      await moveTask(USER, a.id, { afterId: b.id });

      expect((await listTasks(USER, { q: '' })).items.map(({ title }) => title)).toEqual([
        'B',
        'A',
      ]);
    });

    it('refuses to move a task after itself', async () => {
      const { createTask, moveTask } = setup();
      const task = await createTask(USER, input('A'));

      await expect(moveTask(USER, task.id, { afterId: task.id })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('reports a missing task or anchor as NOT_FOUND', async () => {
      const { createTask, moveTask, deleteTask } = setup();
      const task = await createTask(USER, input('A'));
      const anchor = await createTask(USER, input('B'));
      await deleteTask(USER, anchor.id);

      await expect(moveTask(USER, task.id, { afterId: anchor.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(moveTask(STRANGER, task.id, { afterId: null })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('position collisions', () => {
    it('retries a create once and succeeds', async () => {
      const { createTask, keys, listTasks } = setup();
      const existing = await createTask(USER, input('Existing'));
      keys.mockClear().mockImplementationOnce(() => existing.position);

      await createTask(USER, input('New'));

      expect(keys).toHaveBeenCalledTimes(2);
      expect((await listTasks(USER, { q: '' })).items.map(({ title }) => title)).toEqual([
        'New',
        'Existing',
      ]);
    });

    it('gives up on a move after one retry with CONFLICT and changes nothing', async () => {
      const { createTask, moveTask, listTasks, keys } = setup();
      const c = await createTask(USER, input('C'));
      const b = await createTask(USER, input('B'));
      const a = await createTask(USER, input('A'));
      keys.mockClear().mockImplementation(() => b.position);

      await expect(moveTask(USER, a.id, { afterId: c.id })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(keys).toHaveBeenCalledTimes(2);
      expect((await listTasks(USER, { q: '' })).items).toEqual([a, b, c]);
    });
  });
});

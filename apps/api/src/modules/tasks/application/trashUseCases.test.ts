import { fromPlainText } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { keyBetween } from '../domain/ordering';
import { makeMemoryTaskRepository } from '../infrastructure/memoryTaskRepository';
import {
  makeDeleteForever,
  makeEmptyTrash,
  makeListTrash,
  makePurgeTrash,
  makeRestoreTask,
  makeTrashTask,
} from './trashUseCases';
import { makeCreateTask, makeGetTask, makeListTasks } from './useCases';

const USER = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
const STRANGER = '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e';
const DAY = 24 * 60 * 60 * 1000;

const setup = () => {
  const time = { now: new Date('2026-11-12T10:00:00.000Z') };
  const later = (ms: number) => {
    time.now = new Date(time.now.getTime() + ms);
  };
  const deps = {
    tasks: makeMemoryTaskRepository(),
    clock: () => time.now,
    ids: () => crypto.randomUUID(),
    keyBetween,
  };
  const createTask = makeCreateTask(deps);
  return {
    later,
    create: (title: string) =>
      createTask(USER, { title, notes: '', priority: 'medium', dueDate: null }),
    titles: async () =>
      (await makeListTasks(deps)(USER, { q: '' })).items.map(({ title }) => title),
    getTask: makeGetTask(deps),
    trashTask: makeTrashTask(deps),
    listTrash: makeListTrash(deps),
    restoreTask: makeRestoreTask(deps),
    deleteForever: makeDeleteForever(deps),
    emptyTrash: makeEmptyTrash(deps),
    purgeTrash: makePurgeTrash(deps),
  };
};

describe('trash use cases', () => {
  it('moves a task to the trash, stamped now, with the purge date 30 days later', async () => {
    const { create, trashTask, titles } = setup();
    const task = await create('Old idea');

    expect(await trashTask(USER, task.id)).toEqual({
      ...task,
      deletedAt: '2026-11-12T10:00:00.000Z',
      purgeAt: '2026-12-12T10:00:00.000Z',
    });
    expect(await titles()).toEqual([]);
  });

  it('is idempotent: trashing again keeps the first dates', async () => {
    const { create, trashTask, later } = setup();
    const task = await create('Old idea');
    const first = await trashTask(USER, task.id);
    later(DAY);

    expect(await trashTask(USER, task.id)).toEqual(first);
  });

  it('lists the trash with purge dates, most recently deleted first', async () => {
    const { create, trashTask, listTrash, later } = setup();
    const a = await create('A');
    const b = await create('B');
    await trashTask(USER, a.id);
    later(DAY);
    await trashTask(USER, b.id);

    expect((await listTrash(USER)).items.map(({ title, purgeAt }) => [title, purgeAt])).toEqual([
      ['B', '2026-12-13T10:00:00.000Z'],
      ['A', '2026-12-12T10:00:00.000Z'],
    ]);
  });

  it('restores a task where it was', async () => {
    const { create, trashTask, restoreTask, titles } = setup();
    await create('C');
    const b = await create('B');
    await create('A');
    await trashTask(USER, b.id);

    expect(await restoreTask(USER, b.id)).toEqual(b);
    expect(await titles()).toEqual(['A', 'B', 'C']);
  });

  it('deletes forever and empties the trash', async () => {
    const { create, trashTask, deleteForever, emptyTrash, listTrash, restoreTask } = setup();
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');
    await Promise.all([a, b, c].map(({ id }) => trashTask(USER, id)));

    await deleteForever(USER, a.id);
    await expect(restoreTask(USER, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await emptyTrash(USER);
    expect((await listTrash(USER)).items).toEqual([]);
  });

  it('reports a missing, foreign or untrashed task as NOT_FOUND, and leaves it alone', async () => {
    const { create, trashTask, restoreTask, deleteForever, getTask } = setup();
    const task = await create('Mine');

    await expect(trashTask(STRANGER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(restoreTask(STRANGER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteForever(STRANGER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteForever(USER, task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await getTask(USER, task.id)).toEqual({ ...task, notesDoc: fromPlainText(task.notes) });
  });

  it('purges what has been in the trash for 30 days, by the injected clock', async () => {
    const { create, trashTask, listTrash, purgeTrash, later } = setup();
    const old = await create('Old');
    await trashTask(USER, old.id);
    later(DAY);
    const recent = await create('Recent');
    await trashTask(USER, recent.id);

    later(29 * DAY - 1);
    expect(await purgeTrash()).toBe(0);
    later(1);
    expect(await purgeTrash()).toBe(1);
    expect((await listTrash(USER)).items.map(({ title }) => title)).toEqual(['Recent']);
    expect(await purgeTrash()).toBe(0);
  });
});

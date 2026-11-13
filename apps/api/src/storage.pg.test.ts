import { endpoints, Task, TaskList } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { openStorage } from './storage';
import { makeTestApp, signedIn } from './testing';
import { freshSchemaUrl } from './testingPostgres';

describe('openStorage with DATABASE_URL', () => {
  it('migrates Postgres and serves the whole API from it', async () => {
    const storage = await openStorage({
      databaseUrl: await freshSchemaUrl(),
      databaseFile: 'unused.db',
    });
    expect(storage.engine).toBe('postgres');
    const { app } = makeTestApp({
      users: storage.users,
      tasks: storage.tasks,
      checklists: storage.checklists,
    });
    const agent = await signedIn(app);

    const create = async (title: string) =>
      Task.parse((await agent.post(endpoints.createTask.path).send({ title }).expect(201)).body);
    const last = await create('Café au lait');
    const first = await create('École primaire');
    await agent.post(`/api/tasks/${first.id}/move`).send({ afterId: last.id }).expect(200);

    const titles = async (q: string) =>
      TaskList.parse(
        (await agent.get(endpoints.listTasks.path).query({ q }).expect(200)).body,
      ).items.map(({ title }) => title);
    expect(await titles('')).toEqual(['Café au lait', 'École primaire']);
    expect(await titles('CAFÉ')).toEqual(['Café au lait']);
    await storage.close();
  });
});

import { ApiError, Checklist, ChecklistItem, endpoints, Task } from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { type Agent, makeTestApp, signedIn } from './testing';

const errorOf = (response: request.Response) => ApiError.parse(response.body).error;
const MISSING = '0b5c2d7e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

const pathOf = (path: string, params: Record<string, string>): string =>
  path.replace(/:(\w+)/g, (_match, key: string) => params[key] ?? '');

const checklistPath = (taskId: string) => pathOf(endpoints.listChecklist.path, { id: taskId });
const itemPath = (taskId: string, itemId: string) =>
  pathOf(endpoints.updateChecklistItem.path, { id: taskId, itemId });

const add = async (agent: Agent, taskId: string, text: string): Promise<ChecklistItem> =>
  ChecklistItem.parse((await agent.post(checklistPath(taskId)).send({ text }).expect(201)).body);

const texts = async (agent: Agent, taskId: string): Promise<string[]> =>
  Checklist.parse((await agent.get(checklistPath(taskId)).expect(200)).body).items.map(
    ({ text }) => text,
  );

const setup = async () => {
  const { app } = makeTestApp();
  const owner = await signedIn(app, 'owner@example.com');
  const stranger = await signedIn(app, 'stranger@example.com');
  const task = Task.parse(
    (await owner.post(endpoints.createTask.path).send({ title: 'Groceries' }).expect(201)).body,
  );
  return { app, owner, stranger, task };
};

describe('checklist routes require a session', () => {
  it.each([
    ['get', checklistPath(MISSING)],
    ['post', checklistPath(MISSING)],
    ['patch', itemPath(MISSING, MISSING)],
    ['delete', itemPath(MISSING, MISSING)],
    ['post', `${itemPath(MISSING, MISSING)}/move`],
  ] as const)('%s %s -> 401', async (method, path) => {
    const { app } = makeTestApp();
    const response = await request(app)[method](path).send({ text: 'x' });

    expect(response.status).toBe(401);
  });
});

describe('the checklist of a task', () => {
  it('adds items at the bottom, lists them and shows the progress on the task', async () => {
    const { owner, task } = await setup();
    const milk = await add(owner, task.id, '  Oat milk  ');
    await add(owner, task.id, 'Eggs');

    expect(milk).toMatchObject({ taskId: task.id, text: 'Oat milk', notes: '', done: false });
    expect(await texts(owner, task.id)).toEqual(['Oat milk', 'Eggs']);

    await owner.patch(itemPath(task.id, milk.id)).send({ done: true }).expect(200);
    const reread = Task.parse((await owner.get(`/api/tasks/${task.id}`).expect(200)).body);
    expect(reread.checklist).toEqual({ done: 1, total: 2 });
  });

  it('edits, moves and deletes an item', async () => {
    const { owner, task } = await setup();
    const a = await add(owner, task.id, 'A');
    const b = await add(owner, task.id, 'B');

    const edited = await owner.patch(itemPath(task.id, a.id)).send({ notes: 'first' });
    expect(ChecklistItem.parse(edited.body)).toMatchObject({ notes: 'first' });

    await owner
      .post(`${itemPath(task.id, a.id)}/move`)
      .send({ afterId: b.id })
      .expect(200);
    expect(await texts(owner, task.id)).toEqual(['B', 'A']);

    await owner.delete(itemPath(task.id, a.id)).expect(204);
    await owner.delete(itemPath(task.id, a.id)).expect(404);
    expect(await texts(owner, task.id)).toEqual(['B']);
  });

  it("answers 404 for another user's task or item, and for an item of another task", async () => {
    const { owner, stranger, task } = await setup();
    const item = await add(owner, task.id, 'Eggs');
    const other = Task.parse(
      (await owner.post(endpoints.createTask.path).send({ title: 'Other' }).expect(201)).body,
    );

    expect((await stranger.get(checklistPath(task.id))).status).toBe(404);
    expect((await stranger.post(checklistPath(task.id)).send({ text: 'x' })).status).toBe(404);
    expect((await stranger.patch(itemPath(task.id, item.id)).send({ done: true })).status).toBe(
      404,
    );
    expect((await owner.patch(itemPath(other.id, item.id)).send({ done: true })).status).toBe(404);
    expect((await owner.delete(itemPath(other.id, item.id))).status).toBe(404);
    expect(await texts(owner, task.id)).toEqual(['Eggs']);
  });

  it.each([
    ['an empty text', 'post', 'list', { text: '  ' }],
    ['an empty patch', 'patch', 'item', {}],
    ['a client-chosen done flag on create', 'post', 'list', { text: 'x', done: true }],
  ] as const)('answers 400 for %s', async (_label, method, target, body) => {
    const { owner, task } = await setup();
    const item = await add(owner, task.id, 'Eggs');
    const path = target === 'list' ? checklistPath(task.id) : itemPath(task.id, item.id);

    const response = await owner[method](path).send(body);

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });

  it('answers 400 for an item id that is not a UUID and for a move after itself', async () => {
    const { owner, task } = await setup();
    const item = await add(owner, task.id, 'Eggs');

    expect((await owner.patch(itemPath(task.id, '42')).send({ done: true })).status).toBe(400);
    expect(
      (await owner.post(`${itemPath(task.id, item.id)}/move`).send({ afterId: item.id })).status,
    ).toBe(400);
  });

  it('answers 409 when the checklist is full', async () => {
    const { owner, task } = await setup();
    for (let index = 0; index < 50; index += 1) await add(owner, task.id, `Item ${String(index)}`);

    const response = await owner.post(checklistPath(task.id)).send({ text: 'One too many' });

    expect(response.status).toBe(409);
    expect(errorOf(response)).toEqual({
      code: 'CONFLICT',
      message: 'A checklist holds at most 50 items',
    });
  });
});

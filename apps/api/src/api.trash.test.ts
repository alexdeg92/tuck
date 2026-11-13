import {
  ApiError,
  endpoints,
  SearchResult,
  Task,
  TaskList,
  TrashedTask,
  TrashList,
} from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makePurgeTrash } from './modules/tasks/application';
import { makeTestApp, PASSWORD, signedIn } from './testing';

const errorOf = (response: request.Response) => ApiError.parse(response.body).error;
const MISSING = '0b5c2d7e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

type Agent = Awaited<ReturnType<typeof signedIn>>;

const create = async (agent: Agent, title: string): Promise<Task> =>
  Task.parse((await agent.post('/api/tasks').send({ title }).expect(201)).body);

const titles = async (agent: Agent): Promise<string[]> =>
  TaskList.parse((await agent.get('/api/tasks').expect(200)).body).items.map(({ title }) => title);

const trash = async (agent: Agent) =>
  TrashList.parse((await agent.get('/api/trash').expect(200)).body).items;

const setup = async () => {
  const { app, time, deps } = makeTestApp();
  const owner = await signedIn(app, 'owner@example.com');
  const stranger = await signedIn(app, 'stranger@example.com');
  const c = await create(owner, 'C');
  const b = await create(owner, 'B');
  const a = await create(owner, 'A');

  const purge = makePurgeTrash(deps);
  return { app, time, purge, owner, stranger, a, b, c };
};

describe('trash routes require a session', () => {
  it.each([
    ['get', '/api/trash'],
    ['delete', '/api/trash'],
    ['delete', `/api/trash/${MISSING}`],
    ['post', `/api/tasks/${MISSING}/restore`],
  ] as const)('%s %s → 401', async (method, path) => {
    const { app } = makeTestApp();
    expect((await request(app)[method](path)).status).toBe(401);
  });
});

describe('DELETE /api/tasks/:id moves the task to the trash', () => {
  it('returns the trashed task with deletedAt and the server-computed purgeAt', async () => {
    const { owner, a } = await setup();

    const response = await owner.delete(`/api/tasks/${a.id}`).expect(200);

    expect(TrashedTask.parse(response.body)).toEqual({
      ...a,
      deletedAt: '2026-11-11T09:30:00.000Z',
      purgeAt: '2026-12-11T09:30:00.000Z',
    });
    expect(await titles(owner)).toEqual(['B', 'C']);
  });

  it('is idempotent: a repeated delete answers the same trashed task', async () => {
    const { owner, time, a } = await setup();
    const first = TrashedTask.parse((await owner.delete(`/api/tasks/${a.id}`).expect(200)).body);
    time.now = new Date(time.now.getTime() + MINUTE);

    expect((await owner.delete(`/api/tasks/${a.id}`).expect(200)).body).toEqual(first);
  });

  it("answers 404 for another user's task and leaves it alone", async () => {
    const { owner, stranger, a } = await setup();

    expect(errorOf(await stranger.delete(`/api/tasks/${a.id}`).expect(404)).code).toBe('NOT_FOUND');
    expect(await titles(owner)).toEqual(['A', 'B', 'C']);
  });
});

describe('a trashed task is gone from every other route', () => {
  it('is a 404 on get, update, move, related and its checklist', async () => {
    const { owner, a, b } = await setup();
    await owner.post(`/api/tasks/${b.id}/checklist`).send({ text: 'Step' }).expect(201);
    await owner.delete(`/api/tasks/${b.id}`).expect(200);

    await owner.get(`/api/tasks/${b.id}`).expect(404);
    await owner.patch(`/api/tasks/${b.id}`).send({ title: 'Changed' }).expect(404);
    await owner.post(`/api/tasks/${b.id}/move`).send({ afterId: null }).expect(404);
    await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: b.id }).expect(404);
    await owner.get(`/api/tasks/${b.id}/related`).expect(404);
    await owner.get(`/api/tasks/${b.id}/checklist`).expect(404);
    await owner.post(`/api/tasks/${b.id}/checklist`).send({ text: 'More' }).expect(404);
  });

  it('is not found by the list filter, smart search or related tasks', async () => {
    const { owner, a } = await setup();
    const twin = await create(owner, 'Quarterly budget review');
    await create(owner, 'Quarterly budget planning');
    await owner.post(`/api/tasks/${a.id}/checklist`).send({ text: 'budget item' }).expect(201);
    await owner.delete(`/api/tasks/${twin.id}`).expect(200);
    await owner.delete(`/api/tasks/${a.id}`).expect(200);

    const filtered = TaskList.parse((await owner.get('/api/tasks?q=budget').expect(200)).body);
    expect(filtered.items.map(({ title }) => title)).toEqual(['Quarterly budget planning']);
    const found = SearchResult.parse((await owner.get('/api/search?q=budget').expect(200)).body);
    expect(found.hits.map(({ task }) => task.title)).toEqual(['Quarterly budget planning']);
  });
});

describe('GET /api/trash', () => {
  it("lists only the user's trash, most recently deleted first", async () => {
    const { owner, stranger, time, a, c } = await setup();
    await owner.delete(`/api/tasks/${a.id}`).expect(200);
    time.now = new Date(time.now.getTime() + MINUTE);
    await owner.delete(`/api/tasks/${c.id}`).expect(200);
    await stranger.delete(`/api/tasks/${(await create(stranger, 'Theirs')).id}`).expect(200);

    expect((await trash(owner)).map(({ title, purgeAt }) => [title, purgeAt])).toEqual([
      ['C', '2026-12-11T09:31:00.000Z'],
      ['A', '2026-12-11T09:30:00.000Z'],
    ]);
  });
});

describe('POST /api/tasks/:id/restore', () => {
  it('brings the task back where it was, even after the list changed', async () => {
    const { owner, b, c } = await setup();
    await owner.delete(`/api/tasks/${b.id}`).expect(200);
    await create(owner, 'New');
    await owner.post(`/api/tasks/${c.id}/move`).send({ afterId: null }).expect(200);

    expect(Task.parse((await owner.post(`/api/tasks/${b.id}/restore`).expect(200)).body)).toEqual(
      b,
    );
    expect(await titles(owner)).toEqual(['C', 'New', 'A', 'B']);
    expect(await trash(owner)).toEqual([]);
  });

  it("answers 404 for another user's task, a missing one and a purged one", async () => {
    const { owner, stranger, time, purge, a } = await setup();
    await owner.delete(`/api/tasks/${a.id}`).expect(200);

    await stranger.post(`/api/tasks/${a.id}/restore`).expect(404);
    await owner.post(`/api/tasks/${MISSING}/restore`).expect(404);
    expect((await trash(owner)).map(({ title }) => title)).toEqual(['A']);

    time.now = new Date(time.now.getTime() + 30 * DAY);
    expect(await purge()).toBe(1);

    await owner
      .post(endpoints.logIn.path)
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(200);
    await owner.post(`/api/tasks/${a.id}/restore`).expect(404);
  });
});

describe('DELETE /api/trash/:id and DELETE /api/trash', () => {
  it('deletes one trashed task for good, then 404', async () => {
    const { owner, a } = await setup();
    await owner.delete(`/api/tasks/${a.id}`).expect(200);

    await owner.delete(`/api/trash/${a.id}`).expect(204);
    await owner.delete(`/api/trash/${a.id}`).expect(404);
    await owner.post(`/api/tasks/${a.id}/restore`).expect(404);
  });

  it("never deletes a live task or another user's trashed task", async () => {
    const { owner, stranger, a, b } = await setup();
    await owner.delete(`/api/tasks/${b.id}`).expect(200);

    await owner.delete(`/api/trash/${a.id}`).expect(404);
    await stranger.delete(`/api/trash/${b.id}`).expect(404);
    expect(await titles(owner)).toEqual(['A', 'C']);
    expect((await trash(owner)).map(({ title }) => title)).toEqual(['B']);
  });

  it("empties only the user's trash", async () => {
    const { owner, stranger, a, b } = await setup();
    await owner.delete(`/api/tasks/${a.id}`).expect(200);
    await owner.delete(`/api/tasks/${b.id}`).expect(200);
    await stranger.delete(`/api/tasks/${(await create(stranger, 'Theirs')).id}`).expect(200);

    await owner.delete(endpoints.emptyTrash.path).expect(204);

    expect(await trash(owner)).toEqual([]);
    expect(await titles(owner)).toEqual(['C']);
    expect((await trash(stranger)).map(({ title }) => title)).toEqual(['Theirs']);
  });
});

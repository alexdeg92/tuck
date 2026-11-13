import {
  ApiError,
  ChecklistItem,
  endpoints,
  RelatedTasks,
  SearchResult,
  Task,
  TaskHighlights,
} from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { type Agent, makeTestApp, signedIn } from './testing';

const create = async (agent: Agent, title: string, notes = ''): Promise<Task> =>
  Task.parse((await agent.post(endpoints.createTask.path).send({ title, notes }).expect(201)).body);

const addItem = async (agent: Agent, taskId: string, text: string): Promise<ChecklistItem> =>
  ChecklistItem.parse(
    (await agent.post(`/api/tasks/${taskId}/checklist`).send({ text }).expect(201)).body,
  );

const searchFor = async (agent: Agent, q: string): Promise<SearchResult> =>
  SearchResult.parse((await agent.get(endpoints.search.path).query({ q }).expect(200)).body);

describe('GET /api/search', () => {
  it('requires a session', async () => {
    const { app } = makeTestApp();
    expect((await request(app).get(endpoints.search.path).query({ q: 'milk' })).status).toBe(401);
  });

  it('finds a checklist item and says where it matched', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const groceries = await create(agent, 'Groceries');
    const milk = await addItem(agent, groceries.id, 'Oat milk');

    const result = await searchFor(agent, 'oat milk');

    expect(result).toMatchObject({ query: 'oat milk', mode: 'exact', suggestion: null });
    expect(result.hits[0]?.task.id).toBe(groceries.id);
    expect(result.hits[0]?.matches).toEqual([
      {
        field: 'item',
        itemId: milk.id,
        snippet: 'Oat milk',
        sourceStart: 0,
        sourceEnd: 8,
        highlights: [
          [0, 3],
          [4, 8],
        ],
      },
    ]);
  });

  it('suggests a correction and shows close results when nothing matches as typed', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const groceries = await create(agent, 'Groceries');
    await addItem(agent, groceries.id, 'Oat milk');

    const result = await searchFor(agent, 'oat mlik');

    expect(result).toMatchObject({
      mode: 'fuzzy',
      suggestion: { text: 'oat milk', changed: [{ start: 4, end: 8, typed: 'mlik' }] },
    });
    expect(result.hits.map(({ task }) => task.id)).toEqual([groceries.id]);
  });

  it("never returns another user's tasks", async () => {
    const { app } = makeTestApp();
    const owner = await signedIn(app, 'owner@example.com');
    const stranger = await signedIn(app, 'stranger@example.com');
    await create(owner, 'Secret plans');

    expect(await searchFor(stranger, 'secret')).toEqual({
      query: 'secret',
      mode: 'none',
      suggestion: null,
      hits: [],
      truncated: false,
    });
  });

  it('rate-limits each user separately with 429 RATE_LIMITED', async () => {
    const { app } = makeTestApp({ searchRateLimit: { windowMs: 60_000, limit: 2 } });
    const first = await signedIn(app, 'first@example.com');
    const second = await signedIn(app, 'second@example.com');
    const searchAs = (agent: Agent) => agent.get(endpoints.search.path).query({ q: 'milk' });

    expect((await searchAs(first)).status).toBe(200);
    expect((await searchAs(first)).status).toBe(200);
    const limited = await searchAs(first);
    expect(limited.status).toBe(429);
    expect(ApiError.parse(limited.body).error.code).toBe('RATE_LIMITED');
    expect((await searchAs(second)).status).toBe(200);
  });

  it('shares one per-user quota between /api/search and the filtered list', async () => {
    const { app } = makeTestApp({ searchRateLimit: { windowMs: 60_000, limit: 2 } });
    const first = await signedIn(app, 'first@example.com');
    const second = await signedIn(app, 'second@example.com');
    const viaSearch = (agent: Agent) => agent.get(endpoints.search.path).query({ q: 'milk' });
    const viaList = (agent: Agent) => agent.get(endpoints.listTasks.path).query({ q: 'milk' });

    expect((await viaSearch(first)).status).toBe(200);
    expect((await viaList(first)).status).toBe(200);
    expect((await viaList(first)).status).toBe(429);
    expect((await viaSearch(first)).status).toBe(429);
    // The plain list doesn't search, so it doesn't count; the other user has their own quota.
    expect((await first.get(endpoints.listTasks.path)).status).toBe(200);
    expect((await viaList(second)).status).toBe(200);
    expect((await viaSearch(second)).status).toBe(200);
    expect((await viaList(second)).status).toBe(429);
  });

  it('reports truncated when the exact pass spends the budget exactly and the typo pass cannot start', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    for (let index = 0; index < 200; index += 1) {
      await create(agent, 'milk', 'z'.repeat(index === 0 ? 4982 : 4984));
    }

    const result = await searchFor(agent, 'mlik');

    expect(result).toMatchObject({ mode: 'none', hits: [], truncated: true });
  });

  it('keeps truncated false for an ordinary search that finds nothing', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    await create(agent, 'milk');

    expect(await searchFor(agent, 'zzzzzzzz')).toMatchObject({ mode: 'none', truncated: false });
  });

  it('answers an empty query with mode none', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    expect((await searchFor(agent, '')).mode).toBe('none');
  });
});

describe('GET /api/tasks/:id/related', () => {
  it('lists tasks that share unusual words', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const budget = await create(agent, 'Quarterly budget');
    await create(agent, 'Quarterly report');
    await create(agent, 'Water the plants');

    const related = RelatedTasks.parse(
      (await agent.get(`/api/tasks/${budget.id}/related`).expect(200)).body,
    );

    expect(related.items.map(({ title }) => title)).toEqual(['Quarterly report']);
  });

  it("answers 404 for another user's task and 401 without a session", async () => {
    const { app } = makeTestApp();
    const owner = await signedIn(app, 'owner@example.com');
    const stranger = await signedIn(app, 'stranger@example.com');
    const task = await create(owner, 'Mine');

    expect((await stranger.get(`/api/tasks/${task.id}/related`)).status).toBe(404);
    expect((await request(app).get(`/api/tasks/${task.id}/related`)).status).toBe(401);
  });
});

describe('GET /api/tasks/:id/highlights', () => {
  const highlightsOf = (agent: Agent, id: string, q: string) =>
    agent.get(`/api/tasks/${id}/highlights`).query({ q });

  it('requires a session', async () => {
    const { app } = makeTestApp();
    const response = await request(app).get(`/api/tasks/${crypto.randomUUID()}/highlights`);
    expect(response.status).toBe(401);
  });

  it('marks every match over the whole task, in the original text', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const notes = `Café budget. ${'x'.repeat(3000)} The BUDGET review, then budgets again.`;
    const plan = await create(agent, 'Budget plan', notes);
    const check = await addItem(agent, plan.id, 'Check the budget');

    const result = TaskHighlights.parse((await highlightsOf(agent, plan.id, 'budget')).body);

    expect(result).toMatchObject({
      taskUpdatedAt: plan.updatedAt,
      query: 'budget',
      mode: 'exact',
      truncated: false,
    });
    expect(result.fields.title).toEqual([[0, 6]]);
    expect(result.fields.notes.map(([start, end]) => notes.slice(start, end))).toEqual([
      'budget',
      'BUDGET',
      'budget',
    ]);
    expect(result.fields.items).toEqual([
      { itemId: check.id, updatedAt: check.updatedAt, text: [[10, 16]], notes: [] },
    ]);
  });

  it('marks overlapping occurrences of one word as their union', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const fruit = await create(agent, 'Fruit', 'banana');

    const result = TaskHighlights.parse((await highlightsOf(agent, fruit.id, 'ana')).body);
    expect(result).toMatchObject({ fields: { notes: [[1, 6]] }, truncated: false });
  });

  it("returns the same 404 for another user's task as for a missing one", async () => {
    const { app } = makeTestApp();
    const owner = await signedIn(app, 'owner@example.com');
    const stranger = await signedIn(app, 'stranger@example.com');
    const secret = await create(owner, 'Secret budget', 'budget budget');

    const foreign = await highlightsOf(stranger, secret.id, 'budget');
    const missing = await highlightsOf(stranger, crypto.randomUUID(), 'budget');

    expect(foreign.status).toBe(404);
    expect(ApiError.parse(foreign.body)).toEqual(ApiError.parse(missing.body));
  });

  it('refuses a query past the search caps with 400', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const plan = await create(agent, 'Plan');

    const response = await highlightsOf(agent, plan.id, 'x'.repeat(101));
    expect(response.status).toBe(400);
    expect(ApiError.parse(response.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('spends the search quota (it runs the search)', async () => {
    const { app } = makeTestApp({ searchRateLimit: { windowMs: 60_000, limit: 2 } });
    const agent = await signedIn(app);
    const plan = await create(agent, 'Plan');

    await searchFor(agent, 'plan');
    await highlightsOf(agent, plan.id, 'plan').expect(200);
    expect((await highlightsOf(agent, plan.id, 'plan')).status).toBe(429);
  });
});

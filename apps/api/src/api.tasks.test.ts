import {
  ApiError,
  endpoints,
  fromPlainText,
  Task,
  TaskConflictError,
  TaskDetail,
  TaskList,
} from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { keyBetween } from './modules/tasks/domain/ordering';
import { makeTestApp, signedIn } from './testing';

const errorOf = (response: request.Response) => ApiError.parse(response.body).error;
/** The task as GET /api/tasks/:id returns it: plain notes read as paragraphs. */
const detailOf = (task: Task): TaskDetail => ({ ...task, notesDoc: fromPlainText(task.notes) });

const MISSING = '0b5c2d7e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

type Agent = Awaited<ReturnType<typeof signedIn>>;

const create = async (agent: Agent, body: object): Promise<Task> =>
  Task.parse((await agent.post('/api/tasks').send(body).expect(201)).body);

const titles = async (agent: Agent, q?: string): Promise<string[]> => {
  const response = await agent
    .get('/api/tasks')
    .query(q === undefined ? {} : { q })
    .expect(200);
  return TaskList.parse(response.body).items.map(({ title }) => title);
};

/** A signed-in owner with tasks A, B, C (top to bottom) and a second, signed-in user. */
const twoUsers = async (overrides: Parameters<typeof makeTestApp>[0] = {}) => {
  const { app } = makeTestApp(overrides);
  const owner = await signedIn(app, 'owner@example.com');
  const stranger = await signedIn(app, 'stranger@example.com');
  const [c, b, a] = [
    await create(owner, { title: 'C' }),
    await create(owner, { title: 'B' }),
    await create(owner, { title: 'A' }),
  ];
  return { app, owner, stranger, a, b, c };
};

describe('task routes require a session', () => {
  it.each([
    ['get', '/api/tasks'],
    ['post', '/api/tasks'],
    ['get', `/api/tasks/${MISSING}`],
    ['patch', `/api/tasks/${MISSING}`],
    ['delete', `/api/tasks/${MISSING}`],
    ['post', `/api/tasks/${MISSING}/move`],
  ] as const)('%s %s -> 401', async (method, path) => {
    const { app } = makeTestApp();
    const response = await request(app)[method](path).send({ title: 'x' });

    expect(response.status).toBe(401);
    expect(errorOf(response).code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/tasks', () => {
  it('returns an empty list for a new user', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);

    expect((await agent.get('/api/tasks').expect(200)).body).toEqual({ items: [] });
  });

  it("lists the user's own tasks by position and never another user's", async () => {
    const { owner, stranger } = await twoUsers();

    expect(await titles(owner)).toEqual(['A', 'B', 'C']);
    expect(await titles(stranger)).toEqual([]);
  });

  it.each([
    ['milk', ['oat milk']],
    ['  SNAKE_C ', ['snake_case']],
    ["it's", ["it's done"]],
    ['%', ['50% off']],
    ['mlik', []],
    ['', ['50% off', "it's done", 'snake_case', 'oat milk']],
  ])(
    'filters the list by a plain substring with q=%j (no typos: that is /api/search)',
    async (q, expected) => {
      const { app } = makeTestApp();
      const agent = await signedIn(app);
      for (const title of ['oat milk', 'snake_case', "it's done", '50% off'])
        await create(agent, { title });

      expect(await titles(agent, q)).toEqual(expected);
    },
  );

  it.each([
    ['nine different words', 'a,b,c,d,e,f,g,h,i'],
    ['101 characters', 'x'.repeat(101)],
  ])('answers 400 on q for %s, on the list and on search', async (_label, q) => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);

    for (const path of [endpoints.listTasks.path, endpoints.search.path]) {
      const response = await agent.get(path).query({ q });
      expect(response.status, path).toBe(400);
      expect(errorOf(response).details?.[0]?.path, path).toBe('q');
    }
  });

  it('returns 400 for a repeated q parameter', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);

    expect((await agent.get('/api/tasks?q=a&q=b')).status).toBe(400);
  });
});

describe('POST /api/tasks', () => {
  it('returns 201 with server defaults and places the task at the top', async () => {
    const { owner } = await twoUsers();
    const task = await create(owner, { title: '  New  ', dueDate: '2026-12-01' });

    expect(task).toMatchObject({
      title: 'New',
      notes: '',
      status: 'todo',
      priority: 'medium',
      dueDate: '2026-12-01',
    });
    expect(await titles(owner)).toEqual(['New', 'A', 'B', 'C']);
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a client-chosen position', { title: 'x', position: 'a0' }],
    ['an invalid due date', { title: 'x', dueDate: '2026-02-30' }],
    ['a due date before 1900', { title: 'x', dueDate: '1899-12-31' }],
    ['a due date after 9999', { title: 'x', dueDate: '10000-01-01' }],
  ])('returns 400 for %s', async (_label, body) => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const response = await agent.post('/api/tasks').send(body);

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns the task', async () => {
    const { owner, a } = await twoUsers();
    expect((await owner.get(`/api/tasks/${a.id}`).expect(200)).body).toEqual(detailOf(a));
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const { owner } = await twoUsers();
    const response = await owner.get('/api/tasks/42');

    expect(response.status).toBe(400);
    expect(errorOf(response).details?.[0]?.path).toBe('id');
  });

  it("returns the same 404 for a missing task and another user's task", async () => {
    const { owner, stranger, a } = await twoUsers();
    const foreign = await stranger.get(`/api/tasks/${a.id}`);
    const missing = await owner.get(`/api/tasks/${MISSING}`);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates the given fields and returns 200 Task', async () => {
    const { owner, a } = await twoUsers();
    const response = await owner.patch(`/api/tasks/${a.id}`).send({ status: 'done', notes: 'n' });

    expect(response.status).toBe(200);
    const updated = Task.parse(response.body);
    expect(updated).toMatchObject({
      ...a,
      status: 'done',
      notes: 'n',
      completedAt: updated.updatedAt,
      // The test clock is fixed: the write version still moves forward.
      updatedAt: '2026-11-11T09:30:00.001Z',
    });
  });

  it.each([
    ['an empty patch', {}],
    ['an unknown status', { status: 'archived' }],
    ['a position', { position: 'a0' }],
  ])('returns 400 for %s', async (_label, body) => {
    const { owner, a } = await twoUsers();
    expect((await owner.patch(`/api/tasks/${a.id}`).send(body)).status).toBe(400);
  });

  describe('with expectedUpdatedAt', () => {
    const editedElsewhere = async () => {
      const test = makeTestApp();
      const owner = await signedIn(test.app, 'owner@example.com');
      const loaded = await create(owner, { title: 'A', notes: 'base' });
      test.time.now = new Date('2026-11-11T10:05:00.000Z');
      const theirs = Task.parse(
        (await owner.patch(`/api/tasks/${loaded.id}`).send({ notes: 'theirs' }).expect(200)).body,
      );
      test.time.now = new Date('2026-11-11T10:06:00.000Z');
      return { owner, loaded, theirs };
    };

    it('saves when the task is unchanged since it was loaded', async () => {
      const { owner, theirs } = await editedElsewhere();

      const response = await owner
        .patch(`/api/tasks/${theirs.id}`)
        .send({ notes: 'mine', expectedUpdatedAt: theirs.updatedAt });

      expect(response.status).toBe(200);
      expect(Task.parse(response.body)).toMatchObject({
        notes: 'mine',
        updatedAt: '2026-11-11T10:06:00.000Z',
      });
    });

    it('returns 409 CONFLICT with the current task when it changed since, and keeps theirs', async () => {
      const { owner, loaded, theirs } = await editedElsewhere();

      const response = await owner
        .patch(`/api/tasks/${loaded.id}`)
        .send({ notes: 'mine', expectedUpdatedAt: loaded.updatedAt });

      expect(response.status).toBe(409);
      const body = TaskConflictError.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(Task.parse(body.error.current)).toEqual(theirs);
      expect(Task.parse((await owner.get(`/api/tasks/${loaded.id}`)).body)).toEqual(theirs);
    });

    it('refuses a stale PATCH even when the server clock has not moved', async () => {
      const { app } = makeTestApp();
      const owner = await signedIn(app, 'owner@example.com');
      const loaded = await create(owner, { title: 'A', notes: 'base' });

      await owner
        .patch(`/api/tasks/${loaded.id}`)
        .send({ notes: 'first', expectedUpdatedAt: loaded.updatedAt })
        .expect(200);
      const stale = await owner
        .patch(`/api/tasks/${loaded.id}`)
        .send({ notes: 'second stale overwrite', expectedUpdatedAt: loaded.updatedAt });

      expect(stale.status).toBe(409);
      expect(Task.parse((await owner.get(`/api/tasks/${loaded.id}`)).body).notes).toBe('first');
    });

    it("still returns 404, never 409, for another user's task", async () => {
      const { stranger, a } = await twoUsers();

      const response = await stranger
        .patch(`/api/tasks/${a.id}`)
        .send({ notes: 'x', expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });

      expect(response.status).toBe(404);
      expect(response.body).not.toHaveProperty('error.current');
    });
  });

  it("returns 404 for another user's task and leaves it unchanged", async () => {
    const { owner, stranger, a } = await twoUsers();

    expect((await stranger.patch(`/api/tasks/${a.id}`).send({ title: 'Hijacked' })).status).toBe(
      404,
    );
    expect((await owner.get(`/api/tasks/${a.id}`)).body).toEqual(detailOf(a));
  });

  it.each(['1899-12-31', '10000-01-01'])(
    'returns 400 for the due date %s and leaves the task unchanged',
    async (dueDate) => {
      const { owner, a } = await twoUsers();
      const response = await owner.patch(`/api/tasks/${a.id}`).send({ dueDate });

      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_FAILED');
      expect((await owner.get(`/api/tasks/${a.id}`)).body).toEqual(detailOf(a));
    },
  );
});

describe('completed tasks over HTTP', () => {
  it('stamps completedAt, lists done tasks last, and refuses to reorder them', async () => {
    const { owner, a, b } = await twoUsers();

    const done = Task.parse(
      (await owner.patch(`/api/tasks/${a.id}`).send({ status: 'done' }).expect(200)).body,
    );

    expect(done.completedAt).not.toBeNull();
    expect(await titles(owner)).toEqual(['B', 'C', 'A']);
    const response = await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: b.id });
    expect(response.status).toBe(400);
    expect(errorOf(response).message).toBe('A completed task cannot be reordered');
  });
});

describe('POST /api/tasks/:id/move', () => {
  it('moves after an anchor and returns the task with its new position', async () => {
    const { owner, a, c } = await twoUsers();
    const response = await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: c.id });

    expect(response.status).toBe(200);
    expect(Task.parse(response.body).position > c.position).toBe(true);
    expect(await titles(owner)).toEqual(['B', 'C', 'A']);
  });

  it('moves to the top with afterId null', async () => {
    const { owner, c } = await twoUsers();
    await owner.post(`/api/tasks/${c.id}/move`).send({ afterId: null }).expect(200);

    expect(await titles(owner)).toEqual(['C', 'A', 'B']);
  });

  it('keeps the order when the anchor is the current predecessor', async () => {
    const { owner, a, b } = await twoUsers();
    await owner.post(`/api/tasks/${b.id}/move`).send({ afterId: a.id }).expect(200);

    expect(await titles(owner)).toEqual(['A', 'B', 'C']);
  });

  it.each([
    ['after itself', 'self'],
    ['after a non-UUID', '42'],
  ])('returns 400 for a move %s', async (_label, anchor) => {
    const { owner, a } = await twoUsers();
    const afterId = anchor === 'self' ? a.id : anchor;

    expect((await owner.post(`/api/tasks/${a.id}/move`).send({ afterId })).status).toBe(400);
  });

  it("returns 404 for another user's anchor, a trashed anchor and another user's task", async () => {
    const { owner, stranger, a, b } = await twoUsers();
    const foreignAnchor = Task.parse(
      (await stranger.post('/api/tasks').send({ title: 'Theirs' }).expect(201)).body,
    );
    await owner.delete(`/api/tasks/${b.id}`).expect(200);

    expect(
      (await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: foreignAnchor.id })).status,
    ).toBe(404);
    expect((await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: b.id })).status).toBe(404);
    expect((await stranger.post(`/api/tasks/${a.id}/move`).send({ afterId: null })).status).toBe(
      404,
    );
    expect(await titles(owner)).toEqual(['A', 'C']);
  });

  it('returns 409 CONFLICT when the new position keeps colliding, after one retry', async () => {
    let collideWith: string | null = null;
    const { owner, a, b, c } = await twoUsers({
      keyBetween: (before, after) => collideWith ?? keyBetween(before, after),
    });
    collideWith = b.position;

    const response = await owner.post(`/api/tasks/${a.id}/move`).send({ afterId: c.id });

    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('CONFLICT');
    expect(await titles(owner)).toEqual(['A', 'B', 'C']);
  });
});

describe('formatted notes on one task', () => {
  it('reads plain notes as paragraphs on GET and PATCH, and keeps the list free of docs', async () => {
    const { owner, a } = await twoUsers();
    await owner.patch(`/api/tasks/${a.id}`).send({ notes: 'milk\n\n- eggs' }).expect(200);

    const detail = TaskDetail.parse((await owner.get(`/api/tasks/${a.id}`).expect(200)).body);
    expect(detail.notesDoc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'milk' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '- eggs' }] },
      ],
    });
    const patched = await owner.patch(`/api/tasks/${a.id}`).send({ priority: 'high' }).expect(200);
    expect(TaskDetail.parse(patched.body).notesDoc).toEqual(detail.notesDoc);
    const list = (await owner.get('/api/tasks').expect(200)).body as { items: object[] };
    list.items.forEach((item) => {
      expect(item).not.toHaveProperty('notesDoc');
    });
  });
});

describe('long notes over HTTP', () => {
  it('saves notes of 20 000 characters on create and update, and refuses more with 400', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const longest = 'é'.repeat(20_000);

    const created = await agent.post('/api/tasks').send({ title: 'Big', notes: longest });
    expect(created.status).toBe(201);
    const id = Task.parse(created.body).id;
    expect((await agent.patch(`/api/tasks/${id}`).send({ notes: `${longest}!` })).status).toBe(400);
    const updated = await agent.patch(`/api/tasks/${id}`).send({ notes: longest.slice(1) });
    expect(updated.status).toBe(200);
  });
});

describe('notes with Windows newlines', () => {
  it('saves them as \\n and the task stays readable', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const created = await agent
      .post('/api/tasks')
      .send({ title: 'T', notes: 'line one\r\nline two' });
    expect(created.status).toBe(201);
    const id = Task.parse(created.body).id;

    const read = await agent.get(`/api/tasks/${id}`);
    expect(read.status).toBe(200);
    expect(TaskDetail.parse(read.body).notes).toBe('line one\nline two');
    expect((await agent.patch(`/api/tasks/${id}`).send({ title: 'T2' })).status).toBe(200);
  });
});

describe('task bodies', () => {
  it('checks the session before reading a task body', async () => {
    const { app } = makeTestApp();
    const response = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": "not json');
    expect(response.status).toBe(401);
  });

  it('refuses a task body far beyond the longest notes (400, body too large)', async () => {
    const { app } = makeTestApp();
    const agent = await signedIn(app);
    const response = await agent
      .post('/api/tasks')
      .send({ title: 'T', notes: 'x'.repeat(700_000) });
    expect(response.status).toBe(400);
    expect(ApiError.parse(response.body).error.message).toBe('Request body too large');
  });
});

describe('saving formatted notes', () => {
  const doc = (...content: unknown[]) => ({ type: 'doc', content });
  const p = (...content: unknown[]) => ({ type: 'paragraph', content });
  const text = (value: string, ...marks: unknown[]) =>
    marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
  const cell = (value: string) => ({ type: 'tableCell', content: [p(text(value))] });
  const formatted = doc(
    { type: 'heading', attrs: { level: 2 }, content: [text('Plan')] },
    p(text('Buy '), text('oat', { type: 'bold' }), text(' milk')),
    { type: 'table', content: [{ type: 'tableRow', content: [cell('Train'), cell('210')] }] },
  );

  it('stores the doc normalised and its plain text as notes; GET and search read them', async () => {
    const { owner, a } = await twoUsers();
    const saved = await owner
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: formatted, expectedUpdatedAt: a.updatedAt });

    expect(saved.status).toBe(200);
    const detail = TaskDetail.parse(saved.body);
    expect(detail.notes).toBe('Plan\nBuy oat milk\nTrain\t210');
    expect(JSON.stringify(detail.notesDoc)).toContain('{"type":"text","text":"Buy "}');
    expect(TaskDetail.parse((await owner.get(`/api/tasks/${a.id}`)).body)).toEqual(detail);
    const listed = TaskList.parse((await owner.get('/api/tasks')).body).items.find(
      ({ id }) => id === a.id,
    );
    expect(listed?.notes).toBe(detail.notes);
    const found = await owner.get('/api/search').query({ q: 'train' });
    expect(
      (found.body as { hits: { task: { id: string } }[] }).hits.map(({ task }) => task.id),
    ).toContain(a.id);
  });

  it('answers a stale save with 409 and the current task with its formatted notes', async () => {
    const { owner, a } = await twoUsers();
    await owner
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: formatted, expectedUpdatedAt: a.updatedAt });

    const stale = await owner
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: doc(p(text('mine'))), expectedUpdatedAt: a.updatedAt });

    expect(stale.status).toBe(409);
    const body = TaskConflictError.parse(stale.body);
    expect(TaskDetail.parse(body.error.current).notes).toBe('Plan\nBuy oat milk\nTrain\t210');
    expect(body.error.current).toHaveProperty('notesDoc');
  });

  it("returns 404 for another user's task and writes nothing", async () => {
    const { owner, stranger, a } = await twoUsers();
    const response = await stranger
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: formatted, expectedUpdatedAt: a.updatedAt });
    expect(response.status).toBe(404);
    expect(TaskDetail.parse((await owner.get(`/api/tasks/${a.id}`)).body).notes).toBe(a.notes);
  });

  it('refuses an unsafe link and an oversized doc with 400 and a message', async () => {
    const { owner, a } = await twoUsers();
    const unsafe = doc(p(text('x', { type: 'link', attrs: { href: 'javascript:alert(1)' } })));
    expect(
      (
        await owner
          .patch(`/api/tasks/${a.id}`)
          .send({ notesDoc: unsafe, expectedUpdatedAt: a.updatedAt })
      ).status,
    ).toBe(400);
    const link = { type: 'link', attrs: { href: `https://example.com/${'x'.repeat(2000)}` } };
    const heavy = doc(...Array.from({ length: 270 }, () => p(text('ab', link))));
    const response = await owner
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: heavy, expectedUpdatedAt: a.updatedAt });
    expect(response.status).toBe(400);
    expect(ApiError.parse(response.body).error.details?.[0]?.message).toBe(
      'This note is too large to save',
    );
  });

  it('goes back to plain notes when plain notes are saved', async () => {
    const { owner, a } = await twoUsers();
    await owner
      .patch(`/api/tasks/${a.id}`)
      .send({ notesDoc: formatted, expectedUpdatedAt: a.updatedAt });

    await owner.patch(`/api/tasks/${a.id}`).send({ notes: 'just text' }).expect(200);

    const detail = TaskDetail.parse((await owner.get(`/api/tasks/${a.id}`)).body);
    expect(detail.notesDoc).toEqual(fromPlainText('just text'));
  });
});

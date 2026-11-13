import { ChecklistItem, type Endpoint, endpoints, Task } from '@todo/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeTestApp, PASSWORD, signedIn } from './testing';

type Name = keyof typeof endpoints;
type Agent = Awaited<ReturnType<typeof signedIn>>;

const pathOf = (endpoint: Endpoint, params: Record<string, string> = {}): string =>
  endpoint.path.replace(/:(\w+)/g, (_match, key: string) => params[key] ?? '');

const send = (agent: Agent, endpoint: Endpoint, url: string, body?: object) => {
  switch (endpoint.method) {
    case 'GET':
      return agent.get(url);
    case 'POST':
      return body === undefined ? agent.post(url) : agent.post(url).send(body);
    case 'PATCH':
      return agent.patch(url).send(body);
    case 'DELETE':
      return agent.delete(url);
  }
};

const calls: [
  Name,
  (agent: Agent, task: Task, item: ChecklistItem) => { url?: string; body?: object },
][] = [
  ['health', () => ({})],
  ['me', () => ({})],
  ['createTask', () => ({ body: { title: 'Contract' } })],
  ['listTasks', () => ({ url: `${endpoints.listTasks.path}?q=contract` })],
  ['getTask', (_agent, task) => ({ url: pathOf(endpoints.getTask, { id: task.id }) })],
  [
    'updateTask',
    (_agent, task) => ({
      url: pathOf(endpoints.updateTask, { id: task.id }),
      // Not status: the next call reorders this task, and a completed task can't be reordered.
      body: { notes: 'Contract notes' },
    }),
  ],
  [
    'moveTask',
    (_agent, task) => ({
      url: pathOf(endpoints.moveTask, { id: task.id }),
      body: { afterId: null },
    }),
  ],
  ['listChecklist', (_agent, task) => ({ url: pathOf(endpoints.listChecklist, { id: task.id }) })],
  [
    'addChecklistItem',
    (_agent, task) => ({
      url: pathOf(endpoints.addChecklistItem, { id: task.id }),
      body: { text: 'Contract item' },
    }),
  ],
  [
    'updateChecklistItem',
    (_agent, task, item) => ({
      url: pathOf(endpoints.updateChecklistItem, { id: task.id, itemId: item.id }),
      body: { done: true },
    }),
  ],
  [
    'moveChecklistItem',
    (_agent, task, item) => ({
      url: pathOf(endpoints.moveChecklistItem, { id: task.id, itemId: item.id }),
      body: { afterId: null },
    }),
  ],
  [
    'deleteChecklistItem',
    (_agent, task, item) => ({
      url: pathOf(endpoints.deleteChecklistItem, { id: task.id, itemId: item.id }),
    }),
  ],
  ['search', () => ({ url: `${endpoints.search.path}?q=fixture` })],
  ['relatedTasks', (_agent, task) => ({ url: pathOf(endpoints.relatedTasks, { id: task.id }) })],
  [
    'taskHighlights',
    (_agent, task) => ({ url: `${pathOf(endpoints.taskHighlights, { id: task.id })}?q=fixture` }),
  ],

  ['restoreTask', (_agent, task) => ({ url: pathOf(endpoints.restoreTask, { id: task.id }) })],
  ['deleteTask', (_agent, task) => ({ url: pathOf(endpoints.deleteTask, { id: task.id }) })],
  ['listTrash', () => ({})],
  ['deleteForever', (_agent, task) => ({ url: pathOf(endpoints.deleteForever, { id: task.id }) })],
  ['emptyTrash', () => ({})],
  ['logIn', () => ({ body: { email: 'demo@example.com', password: PASSWORD } })],
  // Ends the session every call above used; logOut needs none.
  ['logOutEverywhere', () => ({})],
  ['logOut', () => ({})],
];

describe('every endpoint answers exactly what the contract declares', () => {
  it('covers the whole endpoint map (signUp runs in the setup)', () => {
    expect([...calls.map(([name]) => name), 'signUp'].sort()).toEqual(
      Object.keys(endpoints).sort(),
    );
  });

  it('returns the declared status and a body that parses with the declared response', async () => {
    const { app } = makeTestApp();
    const signUp = await request(app)
      .post(endpoints.signUp.path)
      .send({ email: 'demo@example.com', password: PASSWORD, confirmPassword: PASSWORD });
    expect(signUp.status).toBe(endpoints.signUp.status);
    expect(() => endpoints.signUp.response.parse(signUp.body)).not.toThrow();

    const agent = await signedIn(app, 'owner@example.com');
    const task = Task.parse(
      (await agent.post(endpoints.createTask.path).send({ title: 'Fixture' })).body,
    );
    const item = ChecklistItem.parse(
      (
        await agent
          .post(pathOf(endpoints.addChecklistItem, { id: task.id }))
          .send({ text: 'Fixture item' })
      ).body,
    );

    for (const [name, build] of calls) {
      const endpoint: Endpoint = endpoints[name];
      const { url = endpoint.path, body } = build(agent, task, item);
      const response = await send(agent, endpoint, url, body);

      expect(response.status, name).toBe(endpoint.status);
      if (endpoint.response === null) expect(response.text, name).toBe('');
      else expect(endpoint.response.safeParse(response.body).success, name).toBe(true);
    }
  });
});

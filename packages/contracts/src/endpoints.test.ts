import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { type Endpoint, endpoints, type RequestOf, type ResponseOf } from './endpoints';
import type { UpdateTaskInput } from './tasks';

type Name = keyof typeof endpoints;
type Part = 'params' | 'query' | 'body' | 'response';

const EXAMPLES: Record<Name, Partial<Record<Part, string>>> = {
  signUp: { body: 'sign-up.json', response: 'user.json' },
  logIn: { body: 'credentials.json', response: 'user.json' },
  logOut: {},
  logOutEverywhere: {},
  me: { response: 'user.json' },
  listTasks: { query: 'list-tasks-query.json', response: 'task-list.json' },
  createTask: { body: 'create-task.json', response: 'task.json' },
  getTask: { params: 'task-params.json', response: 'task-detail.json' },
  updateTask: {
    params: 'task-params.json',
    body: 'update-task.json',
    response: 'task-detail.json',
  },
  deleteTask: { params: 'task-params.json', response: 'trashed-task.json' },
  listTrash: { response: 'trash-list.json' },
  restoreTask: { params: 'task-params.json', response: 'task.json' },
  deleteForever: { params: 'task-params.json' },
  emptyTrash: {},
  moveTask: { params: 'task-params.json', body: 'move-task.json', response: 'task.json' },
  health: { response: 'health.json' },
  search: { query: 'search-query.json', response: 'search-result.json' },
  relatedTasks: { params: 'task-params.json', response: 'related-tasks.json' },
  taskHighlights: {
    params: 'task-params.json',
    query: 'search-query.json',
    response: 'task-highlights.json',
  },
  listChecklist: { params: 'task-params.json', response: 'checklist.json' },
  addChecklistItem: {
    params: 'task-params.json',
    body: 'create-checklist-item.json',
    response: 'checklist-item.json',
  },
  updateChecklistItem: {
    params: 'checklist-item-params.json',
    body: 'update-checklist-item.json',
    response: 'checklist-item.json',
  },
  deleteChecklistItem: { params: 'checklist-item-params.json' },
  moveChecklistItem: {
    params: 'checklist-item-params.json',
    body: 'move-checklist-item.json',
    response: 'checklist-item.json',
  },
};

const PARTS: Part[] = ['params', 'query', 'body', 'response'];

const readExample = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));

const pathParams = (path: string): string[] =>
  [...path.matchAll(/:(\w+)/g)].map((match) => match[1] ?? '').sort();

const schemaKeys = (schema: z.ZodType | null): string[] =>
  schema !== null && 'shape' in schema && typeof schema.shape === 'object' && schema.shape !== null
    ? Object.keys(schema.shape).sort()
    : [];

const isName = (name: string): name is Name => name in endpoints;
const all: [Name, Endpoint][] = Object.keys(endpoints)
  .filter(isName)
  .map((name) => [name, endpoints[name]]);

describe('endpoint map', () => {
  it('declares every operation of the REST API exactly once', () => {
    const operations = all.map(([, { method, path }]) => `${method} ${path}`);

    expect(new Set(operations).size).toBe(operations.length);
    expect(operations.sort()).toEqual(
      [
        'DELETE /api/tasks/:id',
        'DELETE /api/trash',
        'DELETE /api/trash/:id',
        'GET /api/trash',
        'POST /api/tasks/:id/restore',
        'DELETE /api/tasks/:id/checklist/:itemId',
        'GET /api/tasks/:id/checklist',
        'PATCH /api/tasks/:id/checklist/:itemId',
        'POST /api/tasks/:id/checklist',
        'POST /api/tasks/:id/checklist/:itemId/move',
        'GET /api/auth/me',
        'GET /api/health',
        'GET /api/search',
        'GET /api/tasks/:id/related',
        'GET /api/tasks/:id/highlights',
        'GET /api/tasks',
        'GET /api/tasks/:id',
        'PATCH /api/tasks/:id',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/auth/logout-all',
        'POST /api/auth/signup',
        'POST /api/tasks',
        'POST /api/tasks/:id/move',
      ].sort(),
    );
  });

  it.each(all)('%s: status 204 exactly when there is no response body', (_name, endpoint) => {
    expect(endpoint.status === 204).toBe(endpoint.response === null);
  });

  it.each(all)('%s: every :param in the path is declared in params', (_name, endpoint) => {
    expect(schemaKeys(endpoint.params)).toEqual(pathParams(endpoint.path));
  });

  it.each(all)('%s: every declared schema has an example that parses', (name, endpoint) => {
    PARTS.forEach((part) => {
      const schema = endpoint[part];
      const file = EXAMPLES[name][part];
      expect(file === undefined, `${name}.${part}`).toBe(schema === null);
      if (schema !== null && file !== undefined) {
        expect(schema.safeParse(readExample(file)).success, `${name}.${part} <- ${file}`).toBe(
          true,
        );
      }
    });
  });
});

type AnyRequest = { params?: unknown; query?: unknown; body?: unknown };

describe('endpoint types (checked by tsc)', () => {
  it('lets a client send exactly the declared parts, as one object', () => {
    expectTypeOf<RequestOf<typeof endpoints.me>>().toExtend<AnyRequest>();
    expectTypeOf<RequestOf<typeof endpoints.listTasks>>().toExtend<AnyRequest>();
    expectTypeOf<RequestOf<typeof endpoints.me>['body']>().toEqualTypeOf<undefined>();
    expectTypeOf<RequestOf<typeof endpoints.updateTask>['params']>().toEqualTypeOf<{
      id: string;
    }>();
    expectTypeOf<RequestOf<typeof endpoints.updateTask>['body']>().toEqualTypeOf<
      z.input<typeof UpdateTaskInput>
    >();
  });

  it('gives the client the parsed response, and undefined for 204', () => {
    expectTypeOf<ResponseOf<typeof endpoints.deleteForever>>().toEqualTypeOf<undefined>();
    expectTypeOf<ResponseOf<typeof endpoints.me>>().toEqualTypeOf<{ id: string; email: string }>();
  });
});

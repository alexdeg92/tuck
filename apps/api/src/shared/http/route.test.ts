import { ApiError, type Endpoint } from '@todo/contracts';
import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { makeErrorHandler } from './errors';
import { route } from './route';

const ID = '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c';

const create = {
  method: 'POST',
  path: '/api/probe/:id',
  params: z.object({ id: z.uuid() }),
  query: z.object({ q: z.string().default('') }),
  body: z.object({ title: z.string().trim().min(1) }),
  status: 201,
  response: z.object({ id: z.uuid(), title: z.string(), q: z.string(), n: z.number().int() }),
} as const satisfies Endpoint;

const remove = {
  method: 'DELETE',
  path: '/api/probe/:id',
  params: z.object({ id: z.uuid() }),
  query: null,
  body: null,
  status: 204,
  response: null,
} as const satisfies Endpoint;

const appWith = (register: (router: Router) => void) => {
  const logError = vi.fn();
  const router = Router();
  register(router);
  return {
    logError,
    app: express().use(express.json()).use(router).use(makeErrorHandler(logError)),
  };
};

describe('route', () => {
  it('hands the handler parsed inputs and answers with the declared status', async () => {
    const handle = vi.fn(
      async ({
        params,
        query,
        body,
      }: {
        params: { id: string };
        query: { q: string };
        body: { title: string };
      }) => Promise.resolve({ id: params.id, title: body.title, q: query.q, n: 1 }),
    );
    const { app } = appWith((router) => route(router, create, handle));

    const response = await request(app).post(`/api/probe/${ID}`).send({ title: '  Hi  ' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: ID, title: 'Hi', q: '', n: 1 });
  });

  it.each([
    ['params', `/api/probe/42`, { title: 'Hi' }, 'id'],
    ['body', `/api/probe/${ID}`, { title: '' }, 'title'],
  ])(
    'answers 400 with details for invalid %s and never calls the handler',
    async (_part, url, body, path) => {
      const handle = vi.fn(() => Promise.resolve({ id: ID, title: 'x', q: '', n: 1 }));
      const { app } = appWith((router) => route(router, create, handle));

      const response = await request(app).post(url).send(body);

      expect(response.status).toBe(400);
      expect(ApiError.parse(response.body).error.details?.[0]?.path).toBe(path);
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it('never sends a reply that drifts from the contract: generic 500, logged', async () => {
    const { app, logError } = appWith((router) =>
      route(router, create, () => Promise.resolve({ id: ID, title: 'x', q: '', n: 1.5 })),
    );

    const response = await request(app).post(`/api/probe/${ID}`).send({ title: 'Hi' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(logError).toHaveBeenCalledOnce();
  });

  it('answers 204 with an empty body when the contract has no response', async () => {
    const handle = vi.fn(() => Promise.resolve());
    const { app } = appWith((router) => route(router, remove, handle));

    const response = await request(app).delete(`/api/probe/${ID}`);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(handle).toHaveBeenCalledWith(
      { params: { id: ID }, query: undefined, body: undefined },
      expect.anything(),
    );
  });
});

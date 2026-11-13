import { Task, TaskList } from '@todo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLogin, useLogout } from '../features/auth/hooks';
import { sessionKeys } from '../features/auth/keys';
import { useCreateTask, useTask, useTasks } from '../features/tasks/hooks';
import { taskKeys } from '../features/tasks/keys';
import { emptyResponse, fixtures, jsonResponse } from '../test/fixtures';
import { requestUrl } from '../test/url';

const exampleList = TaskList.parse(fixtures.taskList);
const exampleTask = Task.parse(fixtures.task);

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('private cache isolation across accounts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears A data so B never sees it while B list/detail are pending', async () => {
    const userA = fixtures.user;
    const userB = {
      ...fixtures.user,
      id: '11111111-1111-4111-8111-111111111111',
      email: 'b@example.com',
    };
    const listA = exampleList;
    const detailA = exampleTask;
    const listPending = deferred<Response>();
    const detailPending = deferred<Response>();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (url.includes('/api/auth/logout') && method === 'POST') {
          return Promise.resolve(emptyResponse());
        }
        if (url.includes('/api/auth/login') && method === 'POST') {
          return Promise.resolve(jsonResponse(userB));
        }
        if (url.startsWith('/api/tasks/') && method === 'GET') return detailPending.promise;
        if (url.startsWith('/api/tasks') && method === 'GET') return listPending.promise;
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(sessionKeys.me(), userA);
    client.setQueryData(taskKeys.list(''), listA);
    client.setQueryData(taskKeys.detail(detailA.id), detailA);

    const logout = renderHook(() => useLogout(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await logout.result.current.mutateAsync();
    });

    expect(client.getQueryData(taskKeys.list(''))).toBeUndefined();
    expect(client.getQueryData(taskKeys.detail(detailA.id))).toBeUndefined();

    const login = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await login.result.current.mutateAsync({
        email: 'b@example.com',
        password: 'demo1234',
      });
    });

    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    const detail = renderHook(() => useTask(detailA.id), { wrapper: wrapperFor(client) });

    expect(list.result.current.data).toBeUndefined();
    expect(detail.result.current.data).toBeUndefined();
    expect(client.getQueryData(taskKeys.list(''))).toBeUndefined();
    expect(client.getQueryData(taskKeys.detail(detailA.id))).toBeUndefined();

    listPending.resolve(jsonResponse({ items: [] }));
    detailPending.resolve(jsonResponse(fixtures.errorNotFound, 404));

    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });
    expect(list.result.current.data).toEqual({ items: [] });
  });

  it('does not let a late create from A reach B after logout', async () => {
    const userA = fixtures.user;
    const userB = {
      ...fixtures.user,
      id: '11111111-1111-4111-8111-111111111111',
      email: 'b@example.com',
    };
    const created = Task.parse({
      ...exampleTask,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'A-only draft',
      position: 'a00',
    });
    const createPending = deferred<Response>();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (url.includes('/api/auth/logout') && method === 'POST') {
          return Promise.resolve(emptyResponse());
        }
        if (url.includes('/api/auth/login') && method === 'POST') {
          return Promise.resolve(jsonResponse(userB));
        }
        if (url.startsWith('/api/tasks') && method === 'POST') return createPending.promise;
        if (url.startsWith('/api/tasks') && method === 'GET') {
          return Promise.resolve(jsonResponse({ items: [] }));
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(sessionKeys.me(), userA);
    client.setQueryData(taskKeys.list(''), exampleList);

    const create = renderHook(() => useCreateTask(), { wrapper: wrapperFor(client) });
    act(() => {
      void create.result.current.mutateAsync({ title: 'A-only draft' }).catch(() => undefined);
    });

    const logout = renderHook(() => useLogout(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await logout.result.current.mutateAsync();
    });
    expect(client.getQueryData(sessionKeys.me())).toBeNull();
    expect(client.getQueriesData({ queryKey: taskKeys.all })).toEqual([]);

    const login = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await login.result.current.mutateAsync({
        email: 'b@example.com',
        password: 'demo1234',
      });
    });

    await act(async () => {
      createPending.resolve(jsonResponse(created, 201));
      await Promise.resolve();
    });

    expect(client.getQueryData(taskKeys.detail(created.id))).toBeUndefined();
    expect(
      client
        .getQueriesData<TaskList>({ queryKey: taskKeys.lists() })
        .flatMap(([, data]) => data?.items ?? [])
        .some((item) => item.title === 'A-only draft' || item.id === created.id),
    ).toBe(false);
    expect(client.isMutating()).toBe(0);
  });
});

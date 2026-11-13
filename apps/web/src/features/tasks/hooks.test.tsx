import { Task, TaskList, TrashedTask } from '@todo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse, trashedResponse } from '../../test/fixtures';
import { requestUrl } from '../../test/url';
import {
  useCreateTask,
  useDeleteTask,
  useMoveTask,
  usePendingTaskTitles,
  useTasks,
  useToggleTaskStatus,
  useUpdateTask,
} from './hooks';
import { taskKeys } from './keys';
import { TrashUndoContext } from '../../shared/lib/trashUndo';

const exampleList = TaskList.parse(fixtures.taskList);
const exampleTask = Task.parse(fixtures.task);

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function firstTwo() {
  const [first, second] = exampleList.items;
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  if (!first || !second) {
    throw new Error('fixture list too short');
  }
  return { first, second };
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

describe('task hooks optimistic updates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keys list queries by q', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.taskList));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useTasks('milk'), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks?q=milk',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(client.getQueryData(taskKeys.list('milk'))).toEqual(exampleList);
  });

  it('create shows a pending title then reconciles the active list from the server', async () => {
    const serverTask = Task.parse({
      ...exampleTask,
      title: 'New from server',
      position: 'a00',
    });
    const serverList = TaskList.parse({ items: [serverTask, ...exampleList.items] });
    let listPayload: TaskList = exampleList;
    const createPending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') return createPending.promise;
        return Promise.resolve(jsonResponse(listPayload));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });

    const create = renderHook(() => useCreateTask(), { wrapper: wrapperFor(client) });
    const pending = renderHook(() => usePendingTaskTitles(), { wrapper: wrapperFor(client) });

    act(() => {
      void create.result.current.mutateAsync({ title: 'New from server' });
    });

    await waitFor(() => {
      expect(pending.result.current).toEqual(['New from server']);
    });
    expect(
      client
        .getQueryData<TaskList>(taskKeys.list(''))
        ?.items.some((item) => item.position === 'optimistic'),
    ).toBeFalsy();

    await act(async () => {
      listPayload = serverList;
      createPending.resolve(jsonResponse(serverTask, 201));
    });

    await waitFor(() => {
      expect(client.getQueryData(taskKeys.list(''))).toEqual(serverList);
      expect(pending.result.current).toEqual([]);
    });
  });

  it('reconciles a filtered create without writing the title into the q cache', async () => {
    const created = Task.parse({ ...exampleTask, title: 'Groceries', position: 'a00' });
    const empty = TaskList.parse({ items: [] });
    const createPending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'POST') return createPending.promise;
        return Promise.resolve(jsonResponse(empty));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = renderHook(() => useTasks('unmatched'), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });

    const create = renderHook(() => useCreateTask(), { wrapper: wrapperFor(client) });
    const pending = renderHook(() => usePendingTaskTitles(), { wrapper: wrapperFor(client) });

    act(() => {
      void create.result.current.mutateAsync({ title: 'Groceries' });
    });

    await waitFor(() => {
      expect(pending.result.current).toEqual(['Groceries']);
    });
    expect(client.getQueryData(taskKeys.list('unmatched'))).toEqual(empty);

    await act(async () => {
      createPending.resolve(jsonResponse(created, 201));
    });

    await waitFor(() => {
      expect(client.getQueryData(taskKeys.list('unmatched'))).toEqual(empty);
      expect(pending.result.current).toEqual([]);
    });
  });

  it('does not let a failed update clobber a concurrent success', async () => {
    const { first, second } = firstTwo();
    const aPending = deferred<Response>();
    const bPending = deferred<Response>();
    let listCalls = 0;
    const finalList = TaskList.parse({
      items: exampleList.items.map((item) =>
        item.id === second.id ? { ...item, status: 'todo' as const } : item,
      ),
    });
    let listPayload: TaskList = exampleList;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (method === 'PATCH' && url.includes(first.id)) return aPending.promise;
        if (method === 'PATCH' && url.includes(second.id)) return bPending.promise;
        if (url.startsWith('/api/tasks') && method === 'GET') {
          listCalls += 1;
          return Promise.resolve(jsonResponse(listPayload));
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });
    const initialListCalls = listCalls;

    const a = renderHook(() => useUpdateTask(), { wrapper: wrapperFor(client) });
    const b = renderHook(() => useUpdateTask(), { wrapper: wrapperFor(client) });

    let aPromise!: Promise<unknown>;
    let bPromise!: Promise<unknown>;
    act(() => {
      aPromise = a.result.current
        .mutateAsync({ id: first.id, input: { status: 'done' } })
        .catch(() => undefined);
      bPromise = b.result.current.mutateAsync({
        id: second.id,
        input: { status: 'todo' },
      });
    });

    await waitFor(() => {
      const items = client.getQueryData<TaskList>(taskKeys.list(''))?.items ?? [];
      expect(items.find((item) => item.id === first.id)?.status).toBe('done');
      expect(items.find((item) => item.id === second.id)?.status).toBe('todo');
    });
    expect(listCalls).toBe(initialListCalls);

    await act(async () => {
      listPayload = finalList;
      aPending.resolve(jsonResponse(fixtures.errorNotFound, 404));
      await aPromise;
    });
    expect(listCalls).toBe(initialListCalls);

    await act(async () => {
      bPending.resolve(jsonResponse({ ...second, status: 'todo' }));
      await bPromise;
    });

    await waitFor(() => {
      expect(client.getQueryData(taskKeys.list(''))).toEqual(finalList);
      expect(listCalls).toBe(initialListCalls + 1);
    });
  });

  it('invalidates only the active list after a failed toggle', async () => {
    const { first } = firstTwo();
    let listCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (method === 'PATCH') return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
        if (url.startsWith('/api/tasks') && method === 'GET') {
          listCalls += 1;
          if (url.includes('q=x')) return Promise.resolve(jsonResponse({ items: [] }));
          return Promise.resolve(jsonResponse(exampleList));
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(taskKeys.list('x'), { items: [] });
    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });
    const before = listCalls;

    const { result } = renderHook(() => useToggleTaskStatus(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current
        .mutateAsync({ id: first.id, done: first.status !== 'done' })
        .catch(() => undefined);
    });

    await waitFor(() => {
      expect(client.getQueryData(taskKeys.list(''))).toEqual(exampleList);
      expect(listCalls).toBe(before + 1);
    });
    expect(client.getQueryState(taskKeys.list('x'))?.isInvalidated).toBe(true);
  });

  it('reorders by afterId without sending position', async () => {
    const { first, second } = firstTwo();
    const fetchMock = vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST') {
        return Promise.resolve(jsonResponse(Task.parse({ ...first, position: 'a05' })));
      }
      return Promise.resolve(jsonResponse(exampleList));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });

    const { result } = renderHook(() => useMoveTask(''), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync({ id: first.id, afterId: second.id });
    });

    const postCall = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    const init = postCall?.[1] as RequestInit | undefined;
    const rawBody = init?.body;
    expect(typeof rawBody).toBe('string');
    const body = JSON.parse(rawBody as string) as { afterId: string };
    expect(body).toEqual({ afterId: second.id });
    expect(body).not.toHaveProperty('position');
  });

  it('deletes optimistically and reconciles on failure', async () => {
    const { first } = firstTwo();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'DELETE') return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
        return Promise.resolve(jsonResponse(exampleList));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const list = renderHook(() => useTasks(''), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(list.result.current.isSuccess).toBe(true);
    });

    const { result } = renderHook(() => useDeleteTask(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.mutateAsync(first.id).catch(() => undefined);
    });

    await waitFor(() => {
      expect(client.getQueryData(taskKeys.list(''))).toEqual(exampleList);
    });
  });

  it('hands each task the server moved to the trash to the Undo offer, even after its row unmounts', async () => {
    const { first, second } = firstTwo();
    let fail = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'DELETE') {
          if (fail) return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
          const url = requestUrl(input);
          const trashed = exampleList.items.find((task) => url.endsWith(task.id));
          return Promise.resolve(trashedResponse(trashed ?? first));
        }
        return Promise.resolve(jsonResponse(exampleList));
      }),
    );
    const trashed = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          <TrashUndoContext.Provider value={{ trashed }}>{children}</TrashUndoContext.Provider>
        </QueryClientProvider>
      );
    }
    const remove = renderHook(() => useDeleteTask(), { wrapper: Wrapper });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = remove.result.current.mutateAsync(first.id);
    });
    remove.unmount();
    await act(async () => {
      await pending;
    });
    expect(TrashedTask.parse(trashed.mock.calls[0]?.[0])).toMatchObject({
      id: first.id,
      title: first.title,
    });

    fail = true;
    const again = renderHook(() => useDeleteTask(), { wrapper: Wrapper });
    await act(async () => {
      await again.result.current.mutateAsync(second.id).catch(() => undefined);
    });
    expect(trashed).toHaveBeenCalledTimes(1);
  });
});

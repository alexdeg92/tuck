import searchResult from '@todo/contracts/examples/search-result.json' with { type: 'json' };
import taskHighlights from '@todo/contracts/examples/task-highlights.json' with { type: 'json' };
import { Task } from '@todo/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../test/fixtures';
import { createTestQueryClient } from '../../test/query';
import { requestUrl } from '../../test/url';
import { useSearch, useSearchQuery, useTaskHighlights } from './hooks';

const task = Task.parse(fixtures.task);

function wrapper(route: string) {
  const client = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSearchQuery', () => {
  function useProbe() {
    const search = useSearchQuery();
    const [, setParams] = useSearchParams();
    const location = useLocation();
    return { ...search, setParams, url: location.search };
  }

  it('starts from ?q= and writes the debounced query back to the URL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(useProbe, { wrapper: wrapper('/tasks?q=budget') });
    expect(result.current).toMatchObject({ input: 'budget', q: 'budget' });

    act(() => {
      result.current.setInput('drawer');
    });
    expect(result.current.q).toBe('budget');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(result.current).toMatchObject({ q: 'drawer', url: '?q=drawer' });
  });

  it('adopts a query changed elsewhere (the finder clears it) without writing the old one back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(useProbe, { wrapper: wrapper('/tasks?q=budget') });

    act(() => {
      result.current.setParams(new URLSearchParams());
    });
    expect(result.current.input).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    expect(result.current).toMatchObject({ input: '', q: '', url: '' });
  });
});

describe('useSearch', () => {
  it('asks /api/search only for a non-empty query', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(searchResult)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const idle = renderHook(() => useSearch(''), { wrapper: wrapper('/') });
    expect(idle.result.current.fetchStatus).toBe('idle');

    const { result } = renderHook(() => useSearch('oat mlik'), { wrapper: wrapper('/') });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.suggestion?.text).toBe('oat milk');
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input))).toEqual([
      '/api/search?q=oat+mlik',
    ]);
  });
});

describe('useTaskHighlights', () => {
  it('fetches the open task map for the query, keyed by the task revision', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(taskHighlights)),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderHook(
      ({ updatedAt }: { updatedAt: string }) => useTaskHighlights({ ...task, updatedAt }, 'budget'),
      { wrapper: wrapper('/'), initialProps: { updatedAt: task.updatedAt } },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    rerender({ updatedAt: '2030-01-01T00:00:00.000Z' });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(requestUrl(fetchMock.mock.calls[0]?.[0] ?? '')).toBe(
      `/api/tasks/${task.id}/highlights?q=budget`,
    );
  });
});

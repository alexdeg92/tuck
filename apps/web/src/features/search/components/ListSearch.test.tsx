import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import searchResult from '@todo/contracts/examples/search-result.json' with { type: 'json' };
import { jsonResponse } from '../../../test/fixtures';
import { createTestQueryClient } from '../../../test/query';
import { ListSearch, type ListSearchView } from './ListSearch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ListSearch', () => {
  it('keeps the same search object when only the route changes (the list pane stays memoized)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(searchResult))),
    );
    const seen: ListSearchView[] = [];
    let go: (path: string) => void = () => undefined;
    function Probe({ search }: { search: ListSearchView }) {
      const navigate = useNavigate();
      go = (path) => {
        void navigate(path);
      };
      seen.push(search);
      return null;
    }
    const element = <ListSearch>{(search) => <Probe search={search} />}</ListSearch>;
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/tasks?q=oat']}>
          <Routes>
            <Route path="/tasks/:id?" element={element} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(seen.at(-1)?.results?.status).toBe('success');
    });
    const before = seen.at(-1);
    const renders = seen.length;

    go('/tasks/3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c?q=oat');
    await waitFor(() => {
      expect(seen.length).toBeGreaterThan(renders);
    });
    expect(seen.at(-1)).toBe(before);
  });
});

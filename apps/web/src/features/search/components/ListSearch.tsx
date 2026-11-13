import type { SearchHit, Task } from '@todo/contracts';
import { useMemo, type ReactNode } from 'react';
import { useSearch, useSearchQuery } from '../hooks';
import { hitExtras } from './HitExtras';
import { SearchBar } from './SearchBar';
import { SearchNotice } from './SearchNotice';

export type ListSearchView = {
  input: string;
  setInput: (value: string) => void;
  q: string;
  bar: ReactNode;
  notice: ReactNode;
  results: {
    status: 'pending' | 'error' | 'success';
    tasks: Task[];
    error: string | null;
    retry: () => void;
    extras: (task: Task) => ReturnType<typeof hitExtras> | undefined;
  } | null;
};

export function ListSearch({ children }: { children: (search: ListSearchView) => ReactNode }) {
  const { input, setInput, q } = useSearchQuery();
  const { status, data, error, refetch } = useSearch(q);

  const search = useMemo((): ListSearchView => {
    const searching = q.trim() !== '';
    const hits = new Map<string, SearchHit>((data?.hits ?? []).map((hit) => [hit.task.id, hit]));
    return {
      input,
      setInput,
      q,
      bar: <SearchBar value={input} onChange={setInput} />,
      notice:
        searching && data !== undefined ? (
          <SearchNotice
            mode={data.mode}
            truncated={data.truncated}
            suggestion={data.suggestion}
            onApply={setInput}
          />
        ) : null,
      results: searching
        ? {
            status,
            tasks: [...hits.values()].map((hit) => hit.task),
            error: error?.message ?? null,
            retry: () => {
              void refetch();
            },
            extras: (task) => {
              const hit = hits.get(task.id);
              return hit === undefined ? undefined : hitExtras(hit);
            },
          }
        : null,
    };
  }, [input, setInput, q, status, data, error, refetch]);

  return children(search);
}

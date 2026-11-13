import type { Task, TaskId } from '@todo/contracts';
import { keepPreviousData, skipToken, useIsMutating, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDebouncedValue } from '../../shared/lib/useDebouncedValue';
import * as searchApi from './api';
import { searchKeys, taskMutationKey } from './keys';

const DEBOUNCE_MS = 250;

export function useSearchQuery() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [input, setInput] = useState(urlQ);
  const q = useDebouncedValue(input, DEBOUNCE_MS);

  const [seen, setSeen] = useState(urlQ);
  if (urlQ !== seen) {
    setSeen(urlQ);
    if (urlQ !== q) setInput(urlQ);
  }

  const written = useRef(urlQ);
  useEffect(() => {
    if (q === written.current) return;
    written.current = q;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (q === '') next.delete('q');
        else next.set('q', q);
        return next;
      },
      { replace: true },
    );
  }, [q, setParams]);

  return { input, setInput, q: input === urlQ ? urlQ : q };
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: searchKeys.results(q),
    queryFn: () => searchApi.search(q),
    enabled: q.trim() !== '',
    placeholderData: keepPreviousData,
  });
}

export function useTaskHighlights(task: Task | undefined, q: string) {
  return useQuery({
    queryKey: searchKeys.highlights(task?.id ?? '', q, task?.updatedAt ?? ''),
    queryFn: task === undefined ? skipToken : () => searchApi.taskHighlights(task.id, q),
    enabled: q.trim() !== '',
  });
}

export function useMatchingChecklist(id: TaskId | undefined, enabled: boolean) {
  return useQuery({
    queryKey: searchKeys.checklist(id ?? ''),
    queryFn: id === undefined ? skipToken : () => searchApi.checklist(id),
    enabled,
  });
}

const mutatesTask = (variables: unknown, id: string): boolean =>
  variables === id ||
  (typeof variables === 'object' && variables !== null && 'id' in variables && variables.id === id);

export function useTaskSaving(id: TaskId | undefined): boolean {
  return (
    useIsMutating({
      mutationKey: taskMutationKey,
      predicate: (mutation) => id !== undefined && mutatesTask(mutation.state.variables, id),
    }) > 0
  );
}

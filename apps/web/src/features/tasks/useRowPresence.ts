import type { Task, TaskId } from '@todo/contracts';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { animationsSettled } from '../../shared/lib/animationsSettled';
import { endPhase, initialPresence, mergeRows, nextPresence } from './presence';

export function useRowPresence(
  rootRef: RefObject<HTMLElement | null>,
  open: Task[],
  done: Task[],
  q: string,
) {
  const [presence, setPresence] = useState(() => initialPresence(open, done, q));
  const next = nextPresence(presence, open, done, q);
  if (next !== presence) setPresence(next);

  const watching = useRef(new WeakMap<Element, string>());

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    for (const element of root.querySelectorAll<HTMLElement>('[data-presence][data-phase]')) {
      const key = element.dataset.presence ?? '';
      const phase = element.dataset.phase ?? '';
      if (watching.current.get(element) === phase) continue;
      watching.current.set(element, phase);
      void animationsSettled(element).then(() => {
        const current = element.isConnected && element.dataset.phase === phase;
        if (!current || watching.current.get(element) !== phase) return;
        watching.current.delete(element);
        setPresence((presence) => endPhase(presence, key, phase));
      });
    }
  });

  const openRows = useMemo(() => mergeRows(open, next, 'open'), [open, next]);
  const doneRows = useMemo(() => mergeRows(done, next, 'done'), [done, next]);

  const noteSwipe = useCallback((id: TaskId, x: number) => {
    setPresence((current) => ({ ...current, swipe: { id, x } }));
  }, []);

  return { phases: next.phases, received: next.received, openRows, doneRows, noteSwipe };
}

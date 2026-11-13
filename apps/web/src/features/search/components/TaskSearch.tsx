import type { Task } from '@todo/contracts';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router';
import { restoreFocus, type FocusPlan } from '../anchor';
import { useMatchingChecklist, useTaskHighlights, useTaskSaving } from '../hooks';
import { counterText, highlightView, sourceName, step } from '../marks';
import { revealMark } from '../scroll';
import { Finder, type FinderState } from './Finder';
import { ReadView } from './ReadView';

export type SearchSlots = { finder?: ReactNode; reading?: ReactNode; onSaved?: () => void };

type FinderSnapshot = {
  q: string;
  fuzzy: boolean;
  state: FinderState;
  counter: string;
  single: boolean;
  truncated: boolean;
};

type Cursor = { scope: string; index: number; seq: number; wrapped: 'first' | 'last' | null };

const noop = () => undefined;

const editable = (element: Element | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));

export function TaskSearch({
  task,
  q,
  children,
}: {
  task: Task | undefined;
  q: string;
  children: (slots: SearchSlots) => ReactNode;
}) {
  const active = q.trim() !== '' && task !== undefined;
  const [, setParams] = useSearchParams();
  const map = useTaskHighlights(task, q);
  const itemsMatched = (map.data?.fields.items.length ?? 0) > 0;
  const checklist = useMatchingChecklist(task?.id, active && itemsMatched);
  const saving = useTaskSaving(task?.id);

  const [session, setSession] = useState<{ taskId: string; id: number } | null>(null);
  const sessions = useRef(0);

  if (session !== null && session.taskId !== task?.id) setSession(null);
  const editing = task !== undefined && session?.taskId === task.id;
  const scope = `${task?.id ?? ''}\n${q}`;
  const [cursor, setCursor] = useState<Cursor>({ scope, index: 0, seq: 0, wrapped: null });
  const readRef = useRef<HTMLDivElement>(null);
  const revealedScope = useRef<string | null>(null);
  const revealedSeq = useRef(0);
  const cancelScroll = useRef<() => void>(() => undefined);
  const refetchedFor = useRef('');
  const finderRef = useRef<HTMLDivElement>(null);

  const pendingFocus = useRef<{ pane: HTMLElement; plan: FocusPlan } | null>(null);

  const leftLayout = useRef<{ scroller: HTMLElement; height: number; scrollTop: number } | null>(
    null,
  );
  const [exiting, setExiting] = useState<FinderSnapshot | null>(null);

  const [saved, setSaved] = useState({ scope: '', count: 0 });

  const view =
    map.data === undefined || task === undefined
      ? null
      : highlightView(map.data, task, checklist.data?.items);
  const occurrences = view?.occurrences ?? [];
  const total = occurrences.length;
  const truncated = map.data?.truncated ?? false;

  const checklistFailed = active && itemsMatched && checklist.isError;
  const mapFailed = map.isError || view?.status === 'invalid';
  const state: FinderState = editing
    ? 'paused'
    : map.isPending || (itemsMatched && checklist.isPending)
      ? 'loading'
      : mapFailed || checklistFailed
        ? 'error'
        : saving || view?.status === 'updating'
          ? 'updating'
          : total === 0
            ? 'none'
            : 'ready';
  const own = cursor.scope === scope;
  const index = own ? Math.min(cursor.index, Math.max(0, total - 1)) : 0;
  const wrapped = own ? cursor.wrapped : null;

  const itemsStale =
    view?.status === 'updating' &&
    map.data?.taskUpdatedAt === task?.updatedAt &&
    checklist.data !== undefined &&
    !saving;
  useEffect(() => {
    if (!itemsStale || map.isFetching || checklist.isFetching) return;
    const revision = `${scope}\n${task?.updatedAt ?? ''}`;
    if (refetchedFor.current === revision) return;
    refetchedFor.current = revision;
    void map.refetch();
    void checklist.refetch();
  }, [itemsStale, map, checklist, scope, task?.updatedAt]);

  useEffect(() => {
    if (state !== 'ready') return;
    const root = readRef.current;

    const scroller = root?.parentElement;
    const mark = root?.querySelector<HTMLElement>(`[data-match="${String(index)}"]`);
    if (!root || !scroller || !mark) return;
    const first = revealedScope.current !== scope;
    if (!first && revealedSeq.current === cursor.seq) return;
    revealedScope.current = scope;
    revealedSeq.current = cursor.seq;
    cancelScroll.current();
    cancelScroll.current = revealMark(scroller, mark, !first);
  }, [state, scope, index, cursor.seq]);

  useEffect(() => {
    if (!active) return;
    const focused = document.activeElement;
    const lost =
      focused === null || focused === document.body || focused.getClientRects().length === 0;
    if (lost) readRef.current?.focus({ preventScroll: true });
  }, [active, scope]);

  useEffect(() => {
    const next = pendingFocus.current;
    if (next === null) return;
    // Wait for the target to be shown: the read view while reading, the editor otherwise (the

    const editorShown = !active || editing;
    if ((next.plan.kind === 'reading') === editorShown) return;
    pendingFocus.current = null;
    restoreFocus(next.pane, next.plan, readRef.current);
  });

  const focusAfterSave = useEffectEvent((savedScope: string) => {
    const pane = readRef.current?.closest('section');
    const focused = document.activeElement;
    const lost = focused === null || focused === document.body || pane?.contains(focused) === true;
    if (savedScope !== scope || editing || !pane || !lost) return;
    restoreFocus(pane, { kind: 'reading' }, readRef.current);
  });
  useEffect(() => {
    if (saved.count > 0) focusAfterSave(saved.scope);
  }, [saved]);

  useLayoutEffect(() => {
    const left = leftLayout.current;
    if (left === null) return;
    leftLayout.current = null;

    // clamped the scroller by that height, which must not be taken off twice.
    left.scroller.scrollTop = Math.max(0, left.scrollTop - left.height);
  });

  function exited(element: HTMLElement | null) {
    const scroller = element?.nextElementSibling;
    if (element && scroller instanceof HTMLElement) {
      leftLayout.current = {
        scroller,
        height: element.getBoundingClientRect().height,
        scrollTop: scroller.scrollTop,
      };
    }
    setExiting(null);
  }

  useEffect(() => {
    if (exiting === null) return;
    const timer = window.setTimeout(() => {
      exited(finderRef.current);
    }, 600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [exiting]);

  const paneOf = () =>
    readRef.current?.closest('section') ?? finderRef.current?.closest('section') ?? null;

  function focusLater(plan: FocusPlan) {
    const pane = paneOf();
    if (pane) pendingFocus.current = { pane, plan };
  }

  function clearPlan(): FocusPlan {
    const current = state === 'ready' ? occurrences[index] : undefined;
    const root = readRef.current;
    const scroller = root?.parentElement;
    const mark = root?.querySelector(`[data-match="${String(index)}"]`);
    if (editing || current === undefined || !scroller || !mark) return { kind: 'editor' };
    const { kind } = current.source;
    if (kind !== 'title' && kind !== 'notes') return { kind: 'editor' };
    return {
      kind: 'anchor',
      field: kind,
      offset: current.range[0],
      viewY: mark.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    };
  }

  function go(direction: 1 | -1) {
    if (state !== 'ready' || total < 2) return;
    const next = step(index, total, direction);
    setCursor({ scope, index: next.index, seq: cursor.seq + 1, wrapped: next.wrapped });
  }

  const onF3 = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const pane = readRef.current?.closest('section');
    if (event.key !== 'F3' || pane?.contains(document.activeElement) !== true) return;
    if (editable(document.activeElement) || state !== 'ready') return;
    event.preventDefault();
    go(event.shiftKey ? -1 : 1);
  });
  useEffect(() => {
    if (!active) return;
    document.addEventListener('keydown', onF3);
    return () => {
      document.removeEventListener('keydown', onF3);
    };
  }, [active]);

  useEffect(
    () => () => {
      cancelScroll.current();
    },
    [],
  );

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    event.preventDefault();
    go(event.shiftKey ? -1 : 1);
  }

  function edit() {
    focusLater({ kind: 'editor' });
    sessions.current += 1;
    setSession(task === undefined ? null : { taskId: task.id, id: sessions.current });
  }

  if (!active) {
    return children(
      exiting === null
        ? {}
        : {
            finder: (
              <Finder
                ref={finderRef}
                exiting={exited}
                {...exiting}
                announcement=""
                onStep={noop}
                onClear={noop}
                onRetry={noop}
                onResume={noop}
                onKeyDown={noop}
              />
            ),
          },
    );
  }

  const savedSession = session?.id ?? null;
  const savedScope = scope;
  const current = occurrences[index];
  const announcement =
    current === undefined
      ? ''
      : [
          wrapped === 'first' ? 'Wrapped to first match.' : null,
          wrapped === 'last' ? 'Wrapped to last match.' : null,
          `Match ${counterText(index, total, truncated)}, ${sourceName(current.source)}.`,
          truncated && index === total - 1 ? 'Last available match.' : null,
        ]
          .filter((part) => part !== null)
          .join(' ');

  return children({
    finder: (
      <Finder
        ref={finderRef}
        q={q}
        fuzzy={map.data?.mode === 'fuzzy'}
        state={state}
        counter={counterText(index, total, truncated)}
        announcement={announcement}
        single={total === 1}
        truncated={truncated}
        onStep={go}
        onClear={() => {
          focusLater(clearPlan());
          setExiting({
            q,
            fuzzy: map.data?.mode === 'fuzzy',
            state,
            counter: counterText(index, total, truncated),
            single: total === 1,
            truncated,
          });
          setParams(
            (params) => {
              const next = new URLSearchParams(params);
              next.delete('q');
              return next;
            },
            { replace: true },
          );
        }}
        onRetry={() => {
          if (mapFailed) void map.refetch();

          if (checklistFailed || (view?.status === 'invalid' && itemsMatched)) {
            void checklist.refetch();
          }
        }}
        onResume={() => {
          focusLater({ kind: 'reading' });
          setSession(null);
        }}
        onKeyDown={onKeyDown}
      />
    ),
    reading: editing ? undefined : (
      <ReadView
        ref={readRef}
        task={task}

        view={state === 'ready' || (state === 'updating' && !saving) ? view : null}
        current={state === 'ready' ? index : null}
        onEdit={edit}
        onKeyDown={onKeyDown}
      />
    ),

    onSaved: () => {
      setSession((current) => (current !== null && current.id === savedSession ? null : current));
      setSaved((last) => ({ scope: savedScope, count: last.count + 1 }));
    },
  });
}

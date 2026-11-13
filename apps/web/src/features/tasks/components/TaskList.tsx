import type { Task, TaskId } from '@todo/contracts';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { splitByStatus } from '../groups';
import type { RowExtras } from '../searchSlots';
import { resultLabel } from '../gestures/rowGestures';
import { useMoveTask, useToggleTaskStatus } from '../hooks';
import { OpenTaskProvider } from '../openTask';
import type { RowDeletion } from '../useRowDeletion';
import { UndoToast } from '../../../shared/ui/UndoToast';
import { RetryToast } from './ResultToasts';
import {
  announcements,
  keepInListViewport,
  moveIntent,
  releasedOutside,
  reorderInstructions,
} from '../reorder';
import { useRowPresence } from '../useRowPresence';
import { TaskRow } from './TaskRow';
import { TaskRowGhost } from './TaskRowGhost';
import styles from './TaskList.module.css';

function swallowClickAfterDrag(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    clear();
  };
  const clear = () => {
    window.removeEventListener('click', swallow, true);
    window.removeEventListener('pointerdown', clear, true);
    window.removeEventListener('keydown', clear, true);
  };
  window.addEventListener('click', swallow, true);
  window.addEventListener('pointerdown', clear, true);
  window.addEventListener('keydown', clear, true);
}

function scrollViewportOf(element: Element): Element | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * The pointer's real position while a drag runs (keyboard drags have none): the drag's own delta
 * is the clamped, x = 0 transform, so it can't tell where the pointer was let go.
 */
function usePointerDuringDrag() {
  const last = useRef<{ x: number; y: number } | null>(null);
  const track = useRef<((event: PointerEvent) => void) | null>(null);
  const stop = useCallback((): { x: number; y: number } | null => {
    if (track.current !== null) window.removeEventListener('pointermove', track.current, true);
    track.current = null;
    const point = last.current;
    last.current = null;
    return point;
  }, []);
  const start = useCallback(() => {
    stop();
    const follow = (event: PointerEvent) => {
      last.current = { x: event.clientX, y: event.clientY };
    };
    track.current = follow;
    window.addEventListener('pointermove', follow, true);
  }, [stop]);
  useEffect(
    () => () => {
      stop();
    },
    [stop],
  );
  return { start, stop };
}

type Outcome = { id: TaskId; done: boolean; undoable: boolean; failed: boolean; seq: number };

function useSwipeCompletion() {
  const { isPending, mutateAsync } = useToggleTaskStatus();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const seq = useRef(0);

  const send = useCallback(
    (id: TaskId, done: boolean, undoable: boolean) => {
      if (isPending) return;
      setOutcome(null);
      const settle = (failed: boolean) => {
        seq.current += 1;
        setOutcome(failed || undoable ? { id, done, undoable, failed, seq: seq.current } : null);
      };
      mutateAsync({ id, done }).then(
        () => {
          settle(false);
        },
        () => {
          settle(true);
        },
      );
    },
    [isPending, mutateAsync],
  );

  return {
    pending: isPending,
    outcome,
    send,
    dismiss: () => {
      setOutcome(null);
    },
  };
}

export function TaskList({
  tasks,
  q,
  deletion,
  empty = null,
  extras,
}: {
  tasks: Task[];
  q: string;

  extras?: ((task: Task) => RowExtras | undefined) | undefined;

  deletion: RowDeletion;

  empty?: ReactNode;
}) {
  const dragDisabled = q.trim() !== '';
  const openListRef = useRef<HTMLUListElement>(null);
  const pointer = usePointerDuringDrag();
  const moveTask = useMoveTask(q);
  const [completedOpen, setCompletedOpen] = useState(false);
  const completion = useSwipeCompletion();
  const outcome = completion.outcome;
  const [announcement, setAnnouncement] = useState('');

  const ranked = q.trim() !== '';
  const { open, done } = useMemo(
    () => (ranked ? { open: tasks, done: [] } : splitByStatus(tasks)),
    [ranked, tasks],
  );

  const openIds = useMemo(() => open.map((task) => task.id), [open]);

  const presenceRoot = useRef<HTMLDivElement>(null);
  const presence = useRowPresence(presenceRoot, open, done, q);
  const sendCompletion = completion.send;
  const noteSwipe = presence.noteSwipe;
  const swipeToggle = useCallback(
    (id: TaskId, done: boolean, fromX: number) => {
      noteSwipe(id, fromX);
      sendCompletion(id, done, true);
    },
    [noteSwipe, sendCompletion],
  );
  const sendDeletion = deletion.send;
  const swipeDelete = useCallback(
    (task: Task, fromX: number) => {
      noteSwipe(task.id, fromX);
      sendDeletion(task);
    },
    [noteSwipe, sendDeletion],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    swallowClickAfterDrag();
    if (dragDisabled) return;
    const { active, over } = event;
    if (!over) return;

    const list = openListRef.current;
    if (list !== null) {
      const viewport = scrollViewportOf(list) ?? list;
      if (releasedOutside(pointer.stop(), viewport.getBoundingClientRect())) return;
    }
    const intent = moveIntent(open, String(active.id), String(over.id));
    if (intent) {
      moveTask.mutate(intent);
    }
  }

  return (
    <OpenTaskProvider>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}

        modifiers={[keepInListViewport]}
        autoScroll={{ threshold: { x: 0, y: 0.2 } }}
        onDragStart={pointer.start}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          pointer.stop();
          swallowClickAfterDrag();
        }}
        accessibility={{
          announcements: announcements(open),
          screenReaderInstructions: {
            draggable: reorderInstructions,
          },
        }}
      >
        {}
        <span className="srOnly" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
        <div ref={presenceRoot} className={styles.presence}>
          {presence.openRows.length > 0 ? (
            <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
              <ul
                ref={openListRef}
                className={cx(recipes.taskList, 'refinedList')}
                aria-label={ranked ? 'Search results' : 'Open tasks'}
              >
                {presence.openRows.map(({ key, task, ghost }) =>
                  ghost !== null ? (
                    <TaskRowGhost key={key} ghost={ghost} />
                  ) : (
                    <TaskRow
                      key={key}
                      task={task}
                      q={q}
                      dragDisabled={dragDisabled}
                      completionPending={completion.pending}
                      onSwipeToggle={swipeToggle}
                      onSwipeDelete={swipeDelete}
                      onAnnounce={setAnnouncement}
                      onDelete={deletion.send}
                      phase={presence.phases[task.id]}
                      extras={extras?.(task)}
                    />
                  ),
                )}
              </ul>
            </SortableContext>
          ) : null}
          {presence.doneRows.length > 0 ? (
            <details
              className="completedGroup"
              open={completedOpen}
              onToggle={(event) => {
                setCompletedOpen(event.currentTarget.open);
              }}
            >
              <summary
                className="completedSummary"
                data-received={presence.received ? 'true' : undefined}
              >
                <ChevronRight aria-hidden="true" />
                <span>Completed</span>
                <span className="completedCount">{done.length}</span>
              </summary>
              <ul className={cx(recipes.taskList, 'completedList')} aria-label="Completed tasks">
                {presence.doneRows.map(({ key, task, ghost }) =>
                  ghost !== null ? (
                    <TaskRowGhost key={key} ghost={ghost} />
                  ) : (
                    <TaskRow
                      key={key}
                      task={task}
                      q={q}
                      dragDisabled
                      completionPending={completion.pending}
                      onSwipeToggle={swipeToggle}
                      onSwipeDelete={swipeDelete}
                      onAnnounce={setAnnouncement}
                      onDelete={deletion.send}
                      phase={presence.phases[task.id]}
                      extras={extras?.(task)}
                    />
                  ),
                )}
              </ul>
            </details>
          ) : null}
          {presence.openRows.length === 0 && presence.doneRows.length === 0 ? empty : null}
        </div>
        {outcome?.failed === true ? (
          <RetryToast
            key={outcome.seq}
            message="Could not update. Retry"
            onRetry={() => {
              completion.send(outcome.id, outcome.done, outcome.undoable);
            }}
          />
        ) : null}
        {outcome !== null && !outcome.failed ? (
          <UndoToast
            key={outcome.seq}
            label={resultLabel(outcome.done)}
            onUndo={() => {
              completion.send(outcome.id, !outcome.done, false);
            }}
            onDismiss={completion.dismiss}
          />
        ) : null}
      </DndContext>
    </OpenTaskProvider>
  );
}

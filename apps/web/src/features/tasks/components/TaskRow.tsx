import type { Task, TaskId } from '@todo/contracts';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Flag, GripVertical, MoreHorizontal } from 'lucide-react';
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { formatDueDate, formatPriority, isDueDateOverdue } from '../../../shared/lib/format';
import { usePhoneTier } from '../../../shared/lib/usePhoneTier';
import { CheckGlyph } from '../../../shared/ui/CheckGlyph';
import { isOwnRowTarget } from '../gestures/rowGestures';
import { useRowGestures } from '../gestures/useRowGestures';
import { useToggleTaskStatus } from '../hooks';
import { useIsOpenTask } from '../openTask';
import type { RowPhase } from '../presence';
import type { RowExtras } from '../searchSlots';
import { TaskSettings, type TaskSettingsHandle } from './TaskSettings';
import styles from './TaskRow.module.css';

function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  if (priority === 'medium') return null;
  return (
    <span className={cx(recipes.material, recipes.priorityBadge)} data-priority={priority}>
      {priority === 'high' ? <Flag aria-hidden="true" /> : null}
      <span>{formatPriority(priority)}</span>
    </span>
  );
}

function pointerActivator(
  listeners: Record<string, unknown> | undefined,
): ((event: ReactPointerEvent) => void) | undefined {
  const handler = listeners?.['onPointerDown'];
  if (typeof handler !== 'function') return undefined;
  return (event) => {
    Reflect.apply(handler, undefined, [event]);
  };
}

function isRowDragSurface(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('.rowCheck, .rowMore, .rowGrip, button, input, textarea, select') === null
  );
}

export const TaskRow = memo(function TaskRow({
  task,
  q,
  dragDisabled,
  completionPending,
  onSwipeToggle,
  onSwipeDelete,
  onAnnounce,
  onDelete,
  phase,
  extras,
}: {
  task: Task;
  q: string;
  dragDisabled: boolean;
  completionPending: boolean;
  onSwipeToggle: (id: TaskId, done: boolean, fromX: number) => void;
  onSwipeDelete: (task: Task, fromX: number) => void;
  onAnnounce: (message: string) => void;
  onDelete: (task: Task) => void;
  phase?: RowPhase | undefined;
  extras?: RowExtras | undefined;
}) {
  const phone = usePhoneTier();
  const toggle = useToggleTaskStatus();
  const selected = useIsOpenTask(task.id);
  const done = task.status === 'done';
  const gripDisabled = dragDisabled || done;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: gripDisabled });
  const startDrag = gripDisabled ? undefined : pointerActivator(listeners);
  const dueLabel = formatDueDate(task.dueDate);
  const overdue = task.dueDate !== null && isDueDateOverdue(task.dueDate);
  const target = {
    pathname: `/tasks/${task.id}`,
    search: q === '' ? '' : `?q=${encodeURIComponent(q)}`,
  };
  const surfaceRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLLIElement | null>(null);
  const settingsRef = useRef<TaskSettingsHandle>(null);

  const [optionsRequest, setOptionsRequest] = useState(0);

  function openRowSettings() {
    setOptionsRequest((count) => count + 1);
  }

  useEffect(() => {
    if (optionsRequest > 0) settingsRef.current?.open();
  }, [optionsRequest]);

  const gestures = useRowGestures({
    enabled: phone,
    dragging: isDragging,
    onHoldDrag: startDrag,
    done,
    pending: completionPending,
    surfaceRef,
    onHold: openRowSettings,
    onToggle: (offset) => {
      onSwipeToggle(task.id, !done, offset);
    },
    onTrash: (offset) => {
      // The same move as Task options (no confirmation, "Moved to trash · Undo"), and the row
      // leaves from where the finger let go.
      onSwipeDelete(task, offset);
    },
    announce: onAnnounce,
  });

  useEffect(() => {
    const node = slotRef.current;
    if (!node || !phone) return;

    const blockSelect = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (
        target.closest(
          '.settingsPopover, input:not([type="checkbox"]), textarea, select, [contenteditable="true"]',
        )
      ) {
        return;
      }
      event.preventDefault();
    };

    node.addEventListener('selectstart', blockSelect);
    node.addEventListener('contextmenu', blockSelect);
    return () => {
      node.removeEventListener('selectstart', blockSelect);
      node.removeEventListener('contextmenu', blockSelect);
    };
  }, [phone]);

  function setRefs(node: HTMLLIElement | null) {
    slotRef.current = node;
    setNodeRef(node);
  }

  const swipeStyle =
    gestures.phase === 'swiping' || gestures.phase === 'settling'
      ? {
          transform: `translate3d(${String(gestures.offset)}px, 0, 0)`,
          transition:
            gestures.phase === 'settling'
              ? 'transform var(--motion-swipe-settle-duration) var(--ease-release)'
              : 'none',
        }
      : undefined;

  return (
    <li
      ref={setRefs}
      className={cx(recipes.rowSlot, phone && styles.touchRow)}

      // context, so a later sibling would otherwise paint over the title (design-pr30c).
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isDragging ? { position: 'relative' as const, zIndex: 'var(--z-drag)' } : {}),
      }}
      aria-label={task.title}
      data-presence={task.id}
      data-phase={phase}
    >
      <div className={cx(recipes.rowClip, phone && styles.swipeClip)}>
        {phone ? (
          <div
            className={styles.swipeUnderlay}
            data-armed={String(gestures.armed)}
            data-gesture={gestures.phase}
            data-side={gestures.side}
            data-action={gestures.action === 'trash' ? 'delete' : done ? 'reopen' : 'complete'}
            aria-hidden="true"
          >
            <span className={styles.swipeLabel}>
              {gestures.action === 'trash' ? null : <Check aria-hidden="true" />}
              {gestures.underlay}
            </span>
          </div>
        ) : null}
        <div
          ref={surfaceRef}
          className={cx(
            recipes.material,
            recipes.taskRow,
            styles.row,
            phone && styles.swipeSurface,
          )}
          data-selected={String(selected)}
          data-done={String(done)}
          data-dragging={String(isDragging)}
          data-held={gestures.phase === 'held' ? 'true' : undefined}
          data-search={extras === undefined ? undefined : 'true'}
          style={swipeStyle}
          onPointerDown={(event) => {
            gestures.onPointerDown(event);
            if (
              !phone &&
              startDrag &&
              isOwnRowTarget(surfaceRef.current, event.target) &&
              isRowDragSurface(event.target)
            ) {
              startDrag(event);
            }
          }}
          onPointerMove={gestures.onPointerMove}
          onPointerUp={gestures.onPointerUp}
          onPointerCancel={gestures.onPointerCancel}
          onLostPointerCapture={gestures.onLostPointerCapture}
          onClickCapture={gestures.onClickCapture}
        >
          <button
            type="button"
            className={cx(recipes.rowGrip, styles.grip)}
            aria-label={`Reorder ${task.title}`}
            title="Drag to reorder"
            disabled={gripDisabled}
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </button>
          <span className={recipes.rowCheck}>
            <label className={recipes.checkControl}>
              <input
                className={recipes.checkInput}
                type="checkbox"
                checked={done}
                disabled={toggle.isPending || completionPending}
                aria-label={`Mark ${task.title} as done`}
                onChange={(event) => {
                  toggle.mutate({ id: task.id, done: event.target.checked });
                }}
              />
              <span className={cx(recipes.material, recipes.checkbox)}>
                <CheckGlyph />
              </span>
            </label>
          </span>
          <Link
            to={target}
            className={cx(recipes.taskLink, styles.link)}
            aria-current={selected ? 'page' : undefined}
            draggable={false}
            onKeyDown={(event) => {
              // Delete on the focused row moves it to the trash (one press, one move).
              if (event.key !== 'Delete' || event.repeat) return;
              event.preventDefault();
              onDelete(task);
            }}
          >
            <span className={recipes.taskTitle}>{extras?.title ?? task.title}</span>
            {extras?.details}
          </Link>
          <div className={recipes.rowMeta}>
            {phase === 'created' ? (
              <span className={recipes.rowResult} aria-hidden="true">
                Created
              </span>
            ) : null}
            {extras?.meta}
            <PriorityBadge priority={task.priority} />
            {dueLabel !== null && dueLabel !== '' ? (
              <span className={recipes.rowDate} data-overdue={overdue ? 'true' : undefined}>
                {dueLabel}
              </span>
            ) : null}
          </div>
          {phone ? (
            <span className={styles.rowOptions}>
              {optionsRequest > 0 ? (
                <TaskSettings
                  ref={settingsRef}
                  task={task}
                  triggerLabel="Task options"
                  triggerClassName={cx('rowMore', styles.rowMore)}
                  triggerIcon={<MoreHorizontal aria-hidden="true" className="flowIcon" />}
                  onDelete={() => {
                    // No confirmation: the task can come back with Undo or from the Trash.
                    onDelete(task);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={cx('rowMore', styles.rowMore)}
                  aria-label="Task options"
                  aria-haspopup="dialog"
                  aria-expanded="false"
                  onClick={() => {
                    openRowSettings();
                  }}
                >
                  <MoreHorizontal aria-hidden="true" className="flowIcon" />
                </button>
              )}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
});

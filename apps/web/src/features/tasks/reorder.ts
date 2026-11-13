import type { Task, TaskId } from '@todo/contracts';
import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Transform } from '@dnd-kit/utilities';

export function moveIntent(
  tasks: Task[],
  activeId: string,
  overId: string,
): { id: TaskId; afterId: TaskId | null } | null {
  const oldIndex = tasks.findIndex((task) => task.id === activeId);
  const newIndex = tasks.findIndex((task) => task.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  const reordered = arrayMove(tasks, oldIndex, newIndex);
  const moved = reordered[newIndex];
  if (!moved) return null;
  return {
    id: moved.id,
    afterId: newIndex === 0 ? null : (reordered[newIndex - 1]?.id ?? null),
  };
}

const position = (tasks: Task[], id: string): number =>
  tasks.findIndex((task) => task.id === id) + 1;

export const reorderInstructions =
  'To reorder, press Space or Enter on the handle, use the arrow keys to move, press Space or Enter to drop, or Escape to cancel.';

export function announcements(tasks: Task[]): Announcements {
  const title = (id: UniqueIdentifier) => tasks.find((task) => task.id === id)?.title ?? 'Task';
  const of = `of ${String(tasks.length)}`;
  return {
    onDragStart: ({ active }) =>
      `Picked up ${title(active.id)}. Position ${String(position(tasks, String(active.id)))} ${of}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${title(active.id)} moved to position ${String(position(tasks, String(over.id)))} ${of}.`
        : `${title(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${title(active.id)} dropped at position ${String(position(tasks, String(over.id)))} ${of}.`
        : `${title(active.id)} dropped.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${title(active.id)} returned to position ${String(position(tasks, String(active.id)))} ${of}.`,
  };
}

type Box = { top: number; bottom: number };

export function keepInListViewport({
  transform,
  draggingNodeRect,
  containerNodeRect,
  scrollableAncestorRects,
}: {
  transform: Transform;
  draggingNodeRect: Box | null;
  containerNodeRect: Box | null;
  scrollableAncestorRects: Box[];
}): Transform {
  const bounds = [containerNodeRect, scrollableAncestorRects[0]].filter(
    (box): box is Box => box !== null && box !== undefined,
  );
  if (draggingNodeRect === null || bounds.length === 0) return { ...transform, x: 0 };
  const top = Math.max(...bounds.map((box) => box.top));
  const bottom = Math.min(...bounds.map((box) => box.bottom));
  const y = Math.min(
    Math.max(transform.y, top - draggingNodeRect.top),
    bottom - draggingNodeRect.bottom,
  );
  return { ...transform, x: 0, y };
}

/**
 * A pointer drag let go of outside the list is cancelled. `point` is the pointer's own last
 * position (the drag's delta is already clamped by the modifier, so it can't say); a keyboard
 * drop has none and is never cancelled here.
 */
export function releasedOutside(
  point: { x: number; y: number } | null,
  list: { left: number; right: number; top: number; bottom: number },
): boolean {
  if (point === null) return false;
  return point.x < list.left || point.x > list.right || point.y < list.top || point.y > list.bottom;
}

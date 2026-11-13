import { TaskList } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../test/fixtures';
import {
  announcements,
  keepInListViewport,
  moveIntent,
  releasedOutside,
  reorderInstructions,
} from './reorder';

describe('reorder helpers', () => {
  const tasks = TaskList.parse(fixtures.taskList).items;

  it('moves a task after another and to the top', () => {
    const [first, second] = tasks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    expect(moveIntent(tasks, first.id, second.id)).toEqual({
      id: first.id,
      afterId: second.id,
    });
    expect(moveIntent(tasks, second.id, first.id)).toEqual({
      id: second.id,
      afterId: null,
    });
    expect(moveIntent(tasks, first.id, first.id)).toBeNull();
  });

  it('builds position-based screen-reader announcements', () => {
    const [first, second] = tasks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;

    const say = announcements(tasks);

    expect(say.onDragStart({ active: { id: first.id } } as never)).toBe(
      `Picked up ${first.title}. Position 1 of 2.`,
    );

    expect(say.onDragOver({ active: { id: first.id }, over: { id: second.id } } as never)).toBe(
      `${first.title} moved to position 2 of 2.`,
    );
    expect(say.onDragEnd({ active: { id: first.id }, over: { id: second.id } } as never)).toBe(
      `${first.title} dropped at position 2 of 2.`,
    );

    expect(say.onDragOver({ active: { id: second.id }, over: { id: first.id } } as never)).toBe(
      `${second.title} moved to position 1 of 2.`,
    );
    expect(say.onDragEnd({ active: { id: second.id }, over: { id: first.id } } as never)).toBe(
      `${second.title} dropped at position 1 of 2.`,
    );
    expect(say.onDragCancel({ active: { id: first.id } } as never)).toBe(
      `Reordering cancelled. ${first.title} returned to position 1 of 2.`,
    );
    expect(say.onDragOver({ active: { id: first.id }, over: null } as never)).toBe(
      `${first.title} is no longer over the list.`,
    );
    expect(say.onDragEnd({ active: { id: first.id }, over: null } as never)).toBe(
      `${first.title} dropped.`,
    );
  });

  it('documents Escape in the keyboard instructions', () => {
    expect(reorderInstructions).toMatch(/Escape to cancel/i);
    expect(reorderInstructions).toMatch(/Space or Enter/i);
    expect(reorderInstructions).toMatch(/arrow keys/i);
  });
});

describe('keepInListViewport (the dragged row stays in the list, vertically)', () => {
  const rect = (top: number, height: number, left = 84, width = 400) => ({
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
  });
  const args = (x: number, y: number, list = rect(100, 500)) => ({
    transform: { x, y, scaleX: 1, scaleY: 1 },
    draggingNodeRect: rect(200, 48),
    containerNodeRect: list,
    scrollableAncestorRects: [rect(100, 500)],
  });

  it('drops any sideways movement, so the list never scrolls or clips horizontally', () => {
    expect(keepInListViewport(args(1050, 20))).toMatchObject({ x: 0, y: 20 });
    expect(keepInListViewport(args(-300, -20))).toMatchObject({ x: 0, y: -20 });
  });

  it('keeps the row inside the scroll viewport of the list', () => {
    expect(keepInListViewport(args(0, -500)).y).toBe(-100);
    expect(keepInListViewport(args(0, 900)).y).toBe(352);
  });

  it('keeps the row inside the list itself when the list is shorter than the viewport', () => {
    // A three-row list (100..244): the row can't sink into the empty body below it.
    expect(keepInListViewport(args(0, 900, rect(100, 144))).y).toBe(-4);
    expect(keepInListViewport(args(0, -500, rect(100, 144))).y).toBe(-100);
  });

  it('only drops x when the rects are not measured yet', () => {
    expect(
      keepInListViewport({
        transform: { x: 9, y: 9, scaleX: 1, scaleY: 1 },
        draggingNodeRect: null,
        containerNodeRect: null,
        scrollableAncestorRects: [],
      }),
    ).toMatchObject({ x: 0, y: 9 });
  });
});

describe('releasedOutside (a drag let go of outside the list is cancelled)', () => {
  const list = { left: 84, right: 494, top: 100, bottom: 400 };

  it('is true only for a real pointer position outside the list', () => {
    expect(releasedOutside({ x: 1050, y: 200 }, list)).toBe(true);
    expect(releasedOutside({ x: 200, y: 450 }, list)).toBe(true);
    expect(releasedOutside({ x: 200, y: 200 }, list)).toBe(false);
  });

  it('never cancels a keyboard drop, which has no pointer position', () => {
    expect(releasedOutside(null, list)).toBe(false);
  });
});

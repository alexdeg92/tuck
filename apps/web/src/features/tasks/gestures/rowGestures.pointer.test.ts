import { describe, expect, it } from 'vitest';
import {
  HOLD_MOVE_PX,
  HOLD_MS,
  SWIPE_LOCK_PX,
  SWIPE_LOCK_RATIO,
  horizontalIntent,
  isEdgeReserved,
  pastThreshold,
  swipeThreshold,
} from './rowGestures';

describe('row gesture pointer thresholds', () => {
  it('locks a swipe only after 12px with |dx| > 1.5×|dy|', () => {
    expect(SWIPE_LOCK_PX).toBe(12);
    expect(SWIPE_LOCK_RATIO).toBe(1.5);
    // Vertical-dominant motion must not lock.
    expect(horizontalIntent(20, 20)).toBe(false);
    expect(horizontalIntent(20, 14)).toBe(false);

    expect(horizontalIntent(13, 8)).toBe(true);
    expect(horizontalIntent(-18, 10)).toBe(true);
  });

  it('arms completion at clamp(64px, 22% width, 96px) in either direction', () => {
    const narrow = swipeThreshold(200);
    const mid = swipeThreshold(400);
    const wide = swipeThreshold(800);
    expect(narrow).toBe(64);
    expect(mid).toBe(88);
    expect(wide).toBe(96);
    expect(pastThreshold(narrow - 1, 200)).toBe(false);
    expect(pastThreshold(narrow, 200)).toBe(true);
    expect(pastThreshold(-narrow, 200)).toBe(true);
    expect(pastThreshold(mid, 400)).toBe(true);
    expect(pastThreshold(wide, 800)).toBe(true);
  });

  it('cancels a hold when movement exceeds 10px before 450ms', () => {
    expect(HOLD_MS).toBe(450);
    expect(HOLD_MOVE_PX).toBe(10);
  });

  it('reserves the outer 24px of the viewport for system edge gestures', () => {
    expect(isEdgeReserved(0, 390)).toBe(true);
    expect(isEdgeReserved(23, 390)).toBe(true);
    expect(isEdgeReserved(24, 390)).toBe(false);
    expect(isEdgeReserved(366, 390)).toBe(false);
    expect(isEdgeReserved(367, 390)).toBe(true);
  });
});

/** Phone-tier swipe and hold thresholds. */

export const HOLD_MS = 450;
/** Movement allowed before the hold arms; past it, the touch is a swipe or a scroll. */
export const HOLD_MOVE_PX = 10;
export const SWIPE_LOCK_PX = 12;
export const SWIPE_LOCK_RATIO = 1.5;
export const EDGE_RESERVE_PX = 24;
export const SETTLE_MS = 160;
/** How long the click that trails a swipe or hold is swallowed, so the title stays put. */
export const CLICK_GUARD_MS = 700;

export function swipeThreshold(rowWidth: number): number {
  return Math.min(96, Math.max(64, rowWidth * 0.22));
}

export function horizontalIntent(dx: number, dy: number): boolean {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  return adx >= SWIPE_LOCK_PX && adx > SWIPE_LOCK_RATIO * ady;
}

export function pastThreshold(dx: number, rowWidth: number): boolean {
  return Math.abs(dx) >= swipeThreshold(rowWidth);
}

/** What a released swipe does. */
export type SwipeAction = 'trash' | 'toggle';

/** Right moves the task to the trash, left completes or reopens it; everything else follows this. */
export function swipeAction(offset: number): SwipeAction {
  return offset > 0 ? 'trash' : 'toggle';
}

export function underlayLabel(action: SwipeAction, done: boolean, armed: boolean): string {
  if (armed) return 'Release';
  if (action === 'trash') return 'Delete';
  return done ? 'Reopen' : 'Complete';
}

export function armedAnnouncement(action: SwipeAction, done: boolean): string {
  if (action === 'trash') return 'Release to delete task.';
  return done ? 'Release to reopen task.' : 'Release to complete task.';
}

export const HOLD_ANNOUNCEMENT = 'Release for task options.';

export function revealedSide(offset: number): 'left' | 'right' {
  return offset >= 0 ? 'left' : 'right';
}

export function resultLabel(done: boolean): string {
  return done ? 'Completed' : 'Reopened';
}

export function isEdgeReserved(clientX: number, viewportWidth: number): boolean {
  return clientX < EDGE_RESERVE_PX || clientX > viewportWidth - EDGE_RESERVE_PX;
}

export function isOwnRowTarget(surface: Element | null, target: EventTarget | null): boolean {
  if (surface === null || !(target instanceof Element) || !surface.contains(target)) return false;
  const layer = target.closest('[popover], dialog, [role="dialog"], [role="menu"]');
  return layer === null || !surface.contains(layer);
}

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  CLICK_GUARD_MS,
  HOLD_MOVE_PX,
  HOLD_MS,
  SETTLE_MS,
  horizontalIntent,
  isEdgeReserved,
  isOwnRowTarget,
  HOLD_ANNOUNCEMENT,
  armedAnnouncement,
  pastThreshold,
  revealedSide,
  swipeAction,
  underlayLabel,
  type SwipeAction,
} from './rowGestures';

export type Phase = 'idle' | 'pressing' | 'held' | 'swiping' | 'settling';

type Press = { id: number; x: number; y: number; width: number; down: ReactPointerEvent };

export type RowGestureApi = {
  phase: Phase;
  offset: number;
  armed: boolean;
  /** What releasing the current swipe would do, from its direction (`swipeAction`). */
  action: SwipeAction;
  underlay: string;
  side: 'left' | 'right';
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onLostPointerCapture: (event: ReactPointerEvent) => void;
  onClickCapture: (event: ReactMouseEvent) => void;
};

function isGestureSurface(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      '.rowGrip, .rowCheck, .rowMore, .taskSettingsButton, input, textarea, select, button',
    ) === null
  );
}

/**
 * Phone-tier row gestures. A swipe past the threshold
 * acts on release: to the right it moves the task to the trash, to the left it toggles completion
 * (`swipeAction` owns that mapping). A 450ms hold shows the held state: releasing without
 * moving opens the options (so the sheet is never light-dismissed by the finger that summoned it),
 * and moving hands the press to the reorder drag (`onHoldDrag`), with the page held still so a
 * scroll can't take the touch over. Cancellation (pointercancel, a scroll, a
 * second pointer, Escape, a move after the hold) only ever returns the row to rest. The click that
 * follows any gesture is swallowed so the title does not open the notes.
 */
export function useRowGestures({
  enabled,
  done,
  pending,
  surfaceRef,
  onToggle,
  onTrash,
  onHold,
  onHoldDrag,
  dragging,
  announce,
}: {
  enabled: boolean;
  done: boolean;
  pending: boolean;
  surfaceRef: RefObject<HTMLElement | null>;

  onToggle: (offset: number) => void;
  /** A released swipe to the trash; the list's move-to-trash path offers Undo. */
  onTrash: (offset: number) => void;
  onHold: () => void;
  /**
   * Starts the reorder drag from the original press, once the hold arms; the drag itself only
   * begins when the finger then moves. Absent when the task can't be reordered.
   */
  onHoldDrag?: ((down: ReactPointerEvent) => void) | undefined;

  dragging: boolean;

  announce: (message: string) => void;
}): RowGestureApi {
  const [phase, setPhase] = useState<Phase>('idle');
  const [offset, setOffset] = useState(0);
  const [armed, setArmed] = useState(false);
  const press = useRef<Press | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clickGuardUntil = useRef(0);
  /** From an armed hold that can drag until the finger lifts: the page must not scroll. */
  const holdingPage = useRef(false);

  const movedAfterHold = useRef(false);

  function guardClick() {
    clickGuardUntil.current = Date.now() + CLICK_GUARD_MS;
  }

  function rest(settle: boolean) {
    clearTimeout(holdTimer.current);
    holdingPage.current = false;
    movedAfterHold.current = false;
    press.current = null;
    setArmed(false);
    // The last offset stays (the surface reads 0 outside a swipe), so while the row settles back
    // the underlay keeps its side, colour and label: a cancelled swipe to the trash stays red
    // instead of flashing the Complete underlay.
    announce('');
    if (!settle) {
      setPhase('idle');
      return;
    }
    setPhase('settling');
    settleTimer.current = setTimeout(() => {
      setPhase('idle');
    }, SETTLE_MS);
  }

  function cancel() {
    if (press.current === null) return;
    guardClick();
    rest(phase === 'swiping');
  }
  const cancelFromWindow = useEffectEvent(cancel);
  const preventHorizontalScroll = useEffectEvent((event: TouchEvent) => {
    const start = press.current;
    const touch = event.touches[0];
    if (start === null || touch === undefined || event.touches.length !== 1) return;
    if (horizontalIntent(touch.clientX - start.x, touch.clientY - start.y)) event.preventDefault();
  });

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!enabled || surface === null) return;
    // A handled horizontal swipe must not start a browser fling that consumes the next tap.

    surface.addEventListener('touchmove', preventHorizontalScroll, { passive: false });
    return () => {
      surface.removeEventListener('touchmove', preventHorizontalScroll);
    };
  }, [enabled, surfaceRef]);

  const active = phase === 'pressing' || phase === 'held' || phase === 'swiping';
  useEffect(() => {
    if (!active) return;
    const onScroll = () => {
      cancelFromWindow();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelFromWindow();
    };
    const onOtherPointer = (event: PointerEvent) => {
      if (event.pointerId !== press.current?.id) cancelFromWindow();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onOtherPointer, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onOtherPointer, true);
    };
  }, [active]);

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      clearTimeout(settleTimer.current);
    },
    [],
  );

  // A non-passive touchmove listener from the start (one added mid-touch can't cancel scrolling);

  useEffect(() => {
    const node = surfaceRef.current;
    if (!enabled || !node) return;
    const holdStill = (event: TouchEvent) => {
      if (holdingPage.current && event.cancelable) event.preventDefault();
    };
    node.addEventListener('touchmove', holdStill, { passive: false });
    return () => {
      node.removeEventListener('touchmove', holdStill);
    };
  }, [enabled, surfaceRef]);

  useEffect(() => {
    if (!dragging) {
      holdingPage.current = false;
      return;
    }
    if (press.current === null) return;
    clearTimeout(holdTimer.current);
    press.current = null;
    setArmed(false);
    setPhase('idle');
    announce('');
  }, [dragging, announce]);

  function isOwn(event: ReactPointerEvent): boolean {
    return press.current !== null && press.current.id === event.pointerId;
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (!enabled || dragging || pending || press.current !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!isOwnRowTarget(surfaceRef.current, event.target) || !isGestureSurface(event.target)) {
      return;
    }
    if (isEdgeReserved(event.clientX, window.innerWidth)) return;

    clearTimeout(settleTimer.current);
    press.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: surfaceRef.current?.offsetWidth ?? 0,
      down: event,
    };
    setPhase('pressing');
    setOffset(0);
    setArmed(false);
    holdTimer.current = setTimeout(() => {
      guardClick();
      setPhase('held');
      announce(HOLD_ANNOUNCEMENT);
      const down = press.current?.down;
      if (onHoldDrag && down) {
        holdingPage.current = true;
        onHoldDrag(down);
      }
    }, HOLD_MS);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const start = press.current;
    if (start === null || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const moved = Math.hypot(dx, dy) > HOLD_MOVE_PX;

    if (phase === 'held') {
      // With a drag handed off, the drag takes the move (see the dragging effect); otherwise a

      if (!moved) return;
      if (holdingPage.current) movedAfterHold.current = true;
      else cancel();
      return;
    }
    if (phase === 'pressing') {
      if (moved) clearTimeout(holdTimer.current);
      if (Math.abs(dy) > HOLD_MOVE_PX && Math.abs(dy) >= Math.abs(dx)) {
        cancel();
        return;
      }
      if (!horizontalIntent(dx, dy)) return;
      clearTimeout(holdTimer.current);
      guardClick();
      setPhase('swiping');
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Intentionally ignored.
      }
    }
    const nowArmed = pastThreshold(dx, start.width);
    const nowAction = swipeAction(dx);
    if (nowArmed !== armed || (nowArmed && nowAction !== swipeAction(offset))) {
      announce(nowArmed ? armedAnnouncement(nowAction, done) : '');
    }
    setOffset(dx);
    setArmed(nowArmed);
  }

  function onPointerUp(event: ReactPointerEvent) {
    const start = press.current;
    if (start === null || start.id !== event.pointerId) return;
    const commit =
      phase === 'swiping' && pastThreshold(event.clientX - start.x, start.width) && !pending;
    if (phase === 'held' || phase === 'swiping') guardClick();
    if (phase === 'held' && !movedAfterHold.current) {
      // After this pointerup has been dispatched, so it cannot light-dismiss the new sheet.
      setTimeout(onHold, 0);
    }
    rest(phase === 'swiping');
    if (!commit) return;
    const released = event.clientX - start.x;
    if (swipeAction(released) === 'trash') onTrash(released);
    else onToggle(released);
  }

  return {
    phase,
    offset: phase === 'swiping' ? offset : 0,
    armed,
    action: swipeAction(offset),
    underlay: underlayLabel(swipeAction(offset), done, armed),
    side: revealedSide(offset),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: (event) => {
      if (isOwn(event)) cancel();
    },
    onLostPointerCapture: (event) => {
      if (isOwn(event) && event.target === event.currentTarget) cancel();
    },
    onClickCapture: (event) => {
      if (Date.now() >= clickGuardUntil.current) return;
      clickGuardUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

import { useEffect, useRef, useState } from 'react';
import recipes from '../../styles/recipes.module.css';
import { cx } from '../lib/cx';
import { NotificationItem } from './NotificationStack';

/** How long an Undo offer stays. */
export const UNDO_DWELL_MS = 8000;

/** The dwell pauses while focused or hovered; Undo is another server mutation, never a client reversal. */
export function UndoToast({
  label,
  onUndo,
  onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const paused = useRef(false);
  const remaining = useRef(UNDO_DWELL_MS);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  const armRef = useRef<(ms: number) => void>(() => undefined);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const arm = (ms: number) => {
      clearTimer();
      started.current = Date.now();
      remaining.current = ms;
      timer.current = setTimeout(() => {
        setLeaving(true);
        leaveTimer.current = setTimeout(() => {
          onDismissRef.current();
        }, 180);
      }, ms);
    };

    armRef.current = arm;
    arm(UNDO_DWELL_MS);

    return () => {
      clearTimer();
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    };
  }, []);

  function pause() {
    if (paused.current) return;
    paused.current = true;
    remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function resume() {
    if (!paused.current) return;
    paused.current = false;
    armRef.current(remaining.current || UNDO_DWELL_MS);
  }

  return (
    <NotificationItem priority={10}>
      <div role="status" aria-live="polite">
        <div
          className={cx(recipes.material, recipes.toast)}
          data-phase={leaving ? 'leaving' : undefined}
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={resume}
        >
          <span className={recipes.toastCopy}>{label}</span>
          <button
            type="button"
            className={cx(recipes.material, recipes.interactive, recipes.button, recipes.secondary)}
            onClick={() => {
              if (timer.current !== null) clearTimeout(timer.current);
              if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
              onUndo();
              onDismiss();
            }}
          >
            Undo
          </button>
        </div>
      </div>
    </NotificationItem>
  );
}

import { useEffect, useRef, useState } from 'react';
import recipes from '../../styles/recipes.module.css';
import { animationsSettled } from '../lib/animationsSettled';
import { cx } from '../lib/cx';
import { NotificationItem } from './NotificationStack';

export function ResultToast(props: { message: string; onDone: () => void }) {
  return (
    <NotificationItem priority={15}>
      <ResultToastSurface {...props} />
    </NotificationItem>
  );
}

function ResultToastSurface({ message, onDone }: { message: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const toast = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const element = toast.current;
    if (element === null) return;
    let live = true;
    void animationsSettled(element, { subtree: false }).then(() => {
      if (!live) return;
      if (leaving) onDoneRef.current();
      else setLeaving(true);
    });
    return () => {
      live = false;
    };
  }, [leaving]);

  return (
    <div role="status" aria-live="polite">
      <div
        ref={toast}
        className={cx(recipes.material, recipes.toast)}
        data-kind="result"
        data-phase={leaving ? 'leaving' : 'dwelling'}
      >
        <span className={recipes.toastCopy}>{message}</span>
      </div>
    </div>
  );
}

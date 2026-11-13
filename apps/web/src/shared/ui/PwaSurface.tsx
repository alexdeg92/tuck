import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NotificationItem } from './NotificationStack';
import { cx } from '../lib/cx';
import styles from './PwaSurface.module.css';

export function PwaSurface({
  visible,
  children,
  className,
  status = false,
  notificationPriority,
}: {
  visible: boolean;
  children: ReactNode;
  className?: string | undefined;
  status?: boolean;
  notificationPriority?: number;
}) {
  const [retained, setRetained] = useState(visible);
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible) return;
    const seconds =
      node.current === null
        ? 0
        : Number.parseFloat(getComputedStyle(node.current).animationDuration);
    const timer = setTimeout(
      () => {
        setRetained(false);
      },
      Number.isFinite(seconds) ? seconds * 1000 + 50 : 230,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [visible]);
  if (visible && !retained) setRetained(true);
  if (!visible && !retained) return null;
  const surface = (
    <div
      ref={node}
      onAnimationEnd={(event) => {
        if (!visible && event.target === event.currentTarget) setRetained(false);
      }}
      className={cx(styles.surface, className)}
      data-exiting={!visible}
      role={status ? 'status' : undefined}
    >
      {children}
    </div>
  );
  return notificationPriority === undefined ? (
    surface
  ) : (
    <NotificationItem priority={notificationPriority}>{surface}</NotificationItem>
  );
}

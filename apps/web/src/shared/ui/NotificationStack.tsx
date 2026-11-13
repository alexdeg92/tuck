import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  focusedTextControl,
  notificationInteractionActive,
  useCompactNotifications,
} from '../lib/useCompactNotifications';
import styles from './NotificationStack.module.css';

type Entry = { id: string; priority: number; content: ReactNode };
type Registry = (entry: Entry) => () => void;
const RegistryContext = createContext<Registry | null>(null);
export const MAX_VISIBLE_NOTIFICATIONS = 3;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Array<Entry & { order: number }>>([]);
  const sequence = useRef(0);
  const compact = useCompactNotifications();
  const limit = compact ? 1 : MAX_VISIBLE_NOTIFICATIONS;
  const stack = useRef<HTMLDivElement>(null);
  const register = useCallback<Registry>((entry) => {
    const order = ++sequence.current;
    setEntries((current) => [
      ...current.filter((item) => item.id !== entry.id),
      { ...entry, order },
    ]);
    return () => {
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    };
  }, []);
  const ordered = useMemo(
    () => [...entries].sort((a, b) => a.priority - b.priority || b.order - a.order),
    [entries],
  );
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const previous = positions.current;
    const next = new Map<string, number>();
    const reduced = compact || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const entry of ordered.slice(0, limit)) {
      const node = nodes.current.get(entry.id);
      if (node === undefined) continue;
      const matrix = getComputedStyle(node).transform;
      const offset = matrix.startsWith('matrix') ? new DOMMatrixReadOnly(matrix).m42 : 0;
      const top = node.getBoundingClientRect().top - offset;
      next.set(entry.id, top);
      const before = previous.get(entry.id);
      // A content-only update must not cancel movement already heading to this slot.
      if (before === undefined || Math.abs(before - top) < 1) continue;
      const presented = before + offset;
      if (typeof node.getAnimations === 'function')
        node.getAnimations().forEach((animation) => {
          animation.cancel();
        });
      if (typeof node.animate === 'function')
        node.animate(
          reduced
            ? [{ opacity: 0.4 }, { opacity: 1 }]
            : [
                { transform: `translateY(${String(presented - top)}px)` },
                { transform: 'translateY(0)' },
              ],
          { duration: reduced ? 150 : 240, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' },
        );
    }
    positions.current = next;
  }, [ordered, limit, compact]);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const place = () => {
      const node = stack.current;
      if (node === null || notificationInteractionActive()) return;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? window.innerHeight;
      const keyboard = Math.max(0, window.innerHeight - height - top);
      node.style.marginBottom = `${String(keyboard)}px`;
      node.style.visibility = '';
      const field = focusedTextControl()?.getBoundingClientRect();
      if (field === undefined) return;
      const rect = node.getBoundingClientRect();
      if (
        rect.left >= field.right ||
        rect.right <= field.left ||
        rect.top >= field.bottom + 24 ||
        rect.bottom <= field.top - 24
      )
        return;
      const lift = rect.bottom - field.top + 24;
      if (rect.top - lift >= top + 16) node.style.marginBottom = `${String(keyboard + lift)}px`;
      else node.style.visibility = 'hidden';
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true });
    document.addEventListener('notificationinteractionend', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('input', schedule);
    document.addEventListener('scroll', schedule, true);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    place();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('notificationinteractionend', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('input', schedule);
      document.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ordered, limit]);
  return (
    <RegistryContext value={register}>
      {children}
      <div
        className={styles.stack}
        ref={stack}
        data-notification-stack
        role="region"
        aria-label="App notifications"
      >
        {ordered.map((entry, index) => (
          <div
            key={entry.id}
            ref={(node) => {
              if (node === null) nodes.current.delete(entry.id);
              else nodes.current.set(entry.id, node);
            }}
            className={styles.item}
            hidden={index >= limit}
          >
            {entry.content}
          </div>
        ))}
      </div>
    </RegistryContext>
  );
}

export function NotificationItem({
  children,
  priority = 10,
}: {
  children: ReactNode;
  priority?: number;
}) {
  const register = useContext(RegistryContext);
  const id = useId();
  useEffect(
    () => register?.({ id, priority, content: children }),
    [register, id, priority, children],
  );
  return register === null ? children : null;
}

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../lib/cx';
import styles from './Menu.module.css';

/** Closes the open menu; `returnFocus` sends the keyboard back to the menu button. */
const CloseMenu = createContext<(returnFocus: boolean) => void>(() => undefined);

/**
 * A menu button (WAI-ARIA menu button pattern): the trigger opens a floating list of actions,
 * the first item takes focus, arrows/Home/End move between items, Escape closes it back to the
 * trigger, Tab or a press outside just closes it.
 */
export function MenuButton({
  label,
  triggerLabel = label,
  triggerTitle,
  triggerClassName,
  className,
  trigger,
  children,
}: {
  /** The menu's accessible name. */
  label: string;
  /** The trigger's accessible name (defaults to `label`). */
  triggerLabel?: string;
  triggerTitle?: string | undefined;
  triggerClassName?: string | undefined;
  className?: string | undefined;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  // On open, the keyboard goes to the first item; a press outside closes without taking focus.
  useEffect(() => {
    if (!open) return undefined;
    items()[0]?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        menu.current?.contains(target) === true ||
        triggerRef.current?.contains(target) === true
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.findIndex((item) => item === document.activeElement);
    const move = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') close(false);
  }

  return (
    <div className={cx(styles.host, className)}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.menu}
          onKeyDown={onKeyDown}
        >
          <CloseMenu.Provider value={close}>{children}</CloseMenu.Provider>
        </div>
      ) : null}
    </div>
  );
}

/** Context, not an action (who is signed in): read by the menu, skipped by the arrows. */
export function MenuNote({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <p role="presentation" className={cx(styles.note, className)}>
      {children}
    </p>
  );
}

/** A rule between groups of items; the arrows skip it. */
export function MenuSeparator() {
  return <div role="separator" className={styles.separator} />;
}

/**
 * One action. Choosing it closes the menu first; `returnFocus` sends the keyboard back to the
 * trigger (for actions that keep the page). `secondary` draws it quieter: a rarer action that
 * should not compete with the one above it.
 */
export function MenuItem({
  onSelect,
  icon,
  secondary = false,
  returnFocus = false,
  busy,
  children,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  secondary?: boolean;
  returnFocus?: boolean;
  busy?: boolean | undefined;
  children: ReactNode;
}) {
  const close = useContext(CloseMenu);
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(styles.item, secondary && styles.secondary)}
      {...(busy === undefined ? {} : { 'aria-busy': busy, 'aria-disabled': busy })}
      onClick={() => {
        close(returnFocus);
        onSelect();
      }}
    >
      {icon}
      {children}
    </button>
  );
}

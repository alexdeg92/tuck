import { Loader2 } from 'lucide-react';
import { useRef, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import recipes from '../../styles/recipes.module.css';
import { cx } from '../lib/cx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variantClass: Record<Variant, string | undefined> = {
  primary: recipes.primary,
  secondary: recipes.secondary,
  danger: recipes.danger,
  ghost: recipes.ghost,
};

/**
 * A button whose children are a `.label` (and icon) can pass `busyLabel`: while `aria-busy`, the
 * label keeps its box but hides, and a spinner plus the busy label take its place, so the button
 * never goes blank or changes width. With `busyLabelVisible` the busy label is shown as text (the
 * button's name then comes from its `aria-label`, so it stays the same while busy).
 *
 * Filled primary/danger buttons briefly set `data-released` after pointer up so the release
 * peak can paint; reduced-motion CSS still cancels the lift.
 */
export function Button({
  variant = 'primary',
  className,
  children,
  busyLabel,
  busyLabelVisible = false,
  onPointerUp,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
  busyLabel?: string;
  busyLabelVisible?: boolean;
}) {
  const busy = props['aria-busy'] === true;
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    onPointerUp?.(event);
    if (event.defaultPrevented) return;
    if (props.disabled === true || props['aria-disabled'] === true || busy) return;
    if (variant !== 'primary' && variant !== 'danger') return;

    const node = event.currentTarget;
    node.dataset.released = 'true';
    if (releaseTimer.current !== null) clearTimeout(releaseTimer.current);
    const raw = getComputedStyle(node).getPropertyValue('--motion-release-duration').trim();
    const ms = Number.parseFloat(raw) || 180;
    releaseTimer.current = setTimeout(() => {
      delete node.dataset.released;
      releaseTimer.current = null;
    }, ms);
  }

  return (
    <button
      type="button"
      className={cx(
        recipes.material,
        recipes.interactive,
        recipes.button,
        variantClass[variant],
        className,
      )}
      {...props}
      onPointerUp={handlePointerUp}
    >
      {children}
      {busy && busyLabel !== undefined ? (
        <span className={recipes.busyContent}>
          <Loader2 className={recipes.spinner} aria-hidden="true" />
          <span className={busyLabelVisible ? undefined : 'srOnly'}>{busyLabel}</span>
        </span>
      ) : null}
    </button>
  );
}

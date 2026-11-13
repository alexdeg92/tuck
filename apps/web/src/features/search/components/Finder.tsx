import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { KeyboardEvent, Ref } from 'react';
import { cx } from '../../../shared/lib/cx';
import { Button } from '../../../shared/ui/Button';
import styles from './Search.module.css';

export type FinderState = 'loading' | 'error' | 'none' | 'updating' | 'paused' | 'ready';

const STATUS: Record<Exclude<FinderState, 'ready'>, string> = {
  loading: 'Finding matches…',
  error: 'Couldn’t load highlights',
  none: 'No matches in this task',
  updating: 'Updating matches…',
  paused: 'Highlighting paused while editing',
};

export function Finder({
  ref,
  exiting,
  q,
  fuzzy,
  state,
  counter,
  announcement,
  single,
  truncated,
  onStep,
  onClear,
  onRetry,
  onResume,
  onKeyDown,
}: {
  ref?: Ref<HTMLDivElement>;

  exiting?: (element: HTMLElement) => void;
  q: string;
  fuzzy: boolean;
  state: FinderState;
  counter: string;
  announcement: string;
  single: boolean;
  truncated: boolean;
  onStep: (direction: 1 | -1) => void;
  onClear: () => void;
  onRetry: () => void;
  onResume: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const stepDisabled = state !== 'ready' || single;
  return (
    <div
      ref={ref}
      className={styles.finder}
      role={exiting ? undefined : 'group'}
      aria-label={exiting ? undefined : 'Search matches'}
      aria-hidden={exiting ? true : undefined}
      inert={exiting !== undefined}
      data-exiting={exiting ? '' : undefined}
      onAnimationEnd={(event) => {
        if (exiting && event.target === event.currentTarget) exiting(event.currentTarget);
      }}
    >
      <span className={styles.query} tabIndex={0} title={q} onKeyDown={onKeyDown}>
        {fuzzy ? 'Close matches for ' : ''}“{q}”
      </span>
      <button
        type="button"
        className={styles.finderButton}
        aria-label="Previous match"
        disabled={stepDisabled}
        onClick={() => {
          onStep(-1);
        }}
      >
        <ChevronUp aria-hidden="true" />
      </button>
      {state === 'ready' ? (
        <span key={counter} className={cx(styles.counter, styles.swap)} aria-hidden="true">
          {counter}
        </span>
      ) : (
        <span key={state} className={cx(styles.status, styles.swap)} aria-hidden="true">
          {STATUS[state]}
        </span>
      )}
      <button
        type="button"
        className={styles.finderButton}
        aria-label="Next match"
        disabled={stepDisabled}
        onClick={() => {
          onStep(1);
        }}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.finderButton}
        aria-label="Clear search"
        onClick={onClear}
      >
        <X aria-hidden="true" />
      </button>
      <span className="srOnly" role="status" aria-live="polite" aria-atomic="true">
        {state === 'ready' ? announcement : STATUS[state]}
      </span>
      {state === 'error' ? (
        <Button variant="secondary" className={styles.finderAction} onClick={onRetry}>
          Retry
        </Button>
      ) : null}
      {state === 'paused' ? (
        <Button variant="secondary" className={styles.finderAction} onClick={onResume}>
          Show matches
        </Button>
      ) : null}
      {truncated && state === 'ready' ? (
        <p className={styles.finderNote}>Some matches aren’t shown. Refine your search.</p>
      ) : null}
    </div>
  );
}

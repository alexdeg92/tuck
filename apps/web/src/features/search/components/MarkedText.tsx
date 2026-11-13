import type { Segment } from '../marks';
import styles from './Search.module.css';

export function MarkedText({
  segments,
  current = null,
}: {
  segments: readonly Segment[];
  current?: number | null;
}) {
  return segments.map((run) =>
    run.mark === null ? (
      run.text
    ) : (
      <mark
        key={run.mark}
        className={styles.mark}
        data-match={run.mark}
        aria-current={run.mark === current ? 'true' : undefined}
      >
        {run.text}
      </mark>
    ),
  );
}

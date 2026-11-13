import type { SearchMode, SearchSuggestion } from '@todo/contracts';
import { segment } from '../marks';
import styles from './Search.module.css';

export function SearchNotice({
  mode,
  truncated,
  suggestion,
  onApply,
}: {
  mode: SearchMode;
  truncated: boolean;
  suggestion: SearchSuggestion | null;
  onApply: (query: string) => void;
}) {
  if (mode !== 'fuzzy' && !truncated) return null;
  return (
    <p className={styles.notice} role="status">
      {mode === 'fuzzy' && suggestion !== null ? (
        <span>
          Did you mean{' '}
          <button
            type="button"
            className={styles.suggestion}
            onClick={() => {
              onApply(suggestion.text);
            }}
          >
            {segment(
              suggestion.text,
              suggestion.changed.map(({ start, end }): [number, number] => [start, end]),
            ).map((run) =>
              run.mark === null ? (
                run.text
              ) : (
                <span key={run.mark} className={styles.changed} data-changed="">
                  {run.text}
                </span>
              ),
            )}
          </button>
          ?
        </span>
      ) : null}
      {mode === 'fuzzy' ? <span className={styles.noticeQuiet}>Showing close matches</span> : null}
      {truncated ? (
        <span className={styles.noticeQuiet}>Some results aren’t shown. Refine your search.</span>
      ) : null}
    </p>
  );
}

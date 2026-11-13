import type { SearchHit } from '@todo/contracts';
import { segment, sourceSummaries, titleRanges } from '../marks';
import { MarkedText } from './MarkedText';
import styles from './Search.module.css';

export function hitExtras(hit: SearchHit) {
  const { task, matches } = hit;
  const ranges = titleRanges(matches);
  const fits = ranges.every(([start, end]) => start < end && end <= task.title.length);
  const summary = sourceSummaries(matches, hit.sourceCounts);
  return {
    title: <MarkedText segments={segment(task.title, fits ? ranges : [])} />,
    details:
      summary.length === 0 ? null : <span className={styles.summary}>{summary.join(' · ')}</span>,
    meta: null,
  };
}

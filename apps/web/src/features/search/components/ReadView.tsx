import type { Task } from '@todo/contracts';
import { Pencil } from 'lucide-react';
import type { KeyboardEvent, Ref } from 'react';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { Button } from '../../../shared/ui/Button';
import { segment, type HighlightView } from '../marks';
import { MarkedText } from './MarkedText';
import styles from './Search.module.css';

/**
 * The whole saved task with every match marked, as selectable text (a textarea can't hold
 * marks). The title, the notes, then the matching checklist items: the counter's order.
 */
export function ReadView({
  ref,
  task,
  view,
  current,
  onEdit,
  onKeyDown,
}: {
  ref: Ref<HTMLDivElement>;
  task: Task;

  view: HighlightView | null;
  current: number | null;
  onEdit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const occurrences = view?.occurrences ?? [];
  const title = occurrences.filter((o) => o.source.kind === 'title').map((o) => o.range);
  const notes = occurrences.filter((o) => o.source.kind === 'notes').map((o) => o.range);
  const items = view?.items ?? [];

  return (
    <div
      ref={ref}
      className={styles.readView}
      role="region"
      aria-label="Task with search matches"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className={styles.readHead}>
        <h2 className={styles.readTitle}>
          <MarkedText segments={segment(task.title, title)} current={current} />
        </h2>
        <Button variant="secondary" onClick={onEdit}>
          <Pencil className={recipes.buttonIcon} aria-hidden="true" />
          <span className={recipes.label}>Edit note</span>
        </Button>
      </div>
      {task.notes === '' ? (
        <p className={cx(styles.readNotes, styles.readEmpty)}>No notes</p>
      ) : (
        <p className={styles.readNotes}>
          <MarkedText segments={segment(task.notes, notes, title.length)} current={current} />
        </p>
      )}
      {items.length > 0 ? (
        <section aria-label="Matching checklist items">
          <h3 className={styles.itemsTitle}>Checklist</h3>
          <ul className={styles.items}>
            {items.map(({ item, text, notes: itemNotes, first }) => (
              <li key={item.id}>
                <span className={styles.itemText}>
                  <MarkedText segments={segment(item.text, text, first)} current={current} />
                </span>
                {item.notes === '' ? null : (
                  <span className={styles.itemNotes}>
                    <MarkedText
                      segments={segment(item.notes, itemNotes, first + text.length)}
                      current={current}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

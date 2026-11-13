import { Check, ChevronRight, Flag } from 'lucide-react';
import styles from './AuthLayout.module.css';

/** Fictional sample tasks: the preview shows the product, never anyone's data. */
const SAMPLE = [
  { title: 'Send the revised proposal', meta: 'High · Today', high: true },
  { title: 'Review the homepage copy', meta: 'Tomorrow', high: false },
  { title: 'Prepare handover notes', meta: 'Nov 18', high: false },
] as const;

/**
 * A static rendering of the workspace: the ruled task list beside the open task's notes. It is
 * inert, a picture of the product made of real markup, not a second application.
 */
export function WorkspacePreview() {
  return (
    <figure className={styles.preview} aria-label="Workspace preview" inert>
      <div className={styles.previewHead}>
        <strong>Tasks</strong>
        <span>3 open · 1 completed</span>
      </div>
      <div className={styles.previewPanes}>
        <ul className={styles.previewList}>
          {SAMPLE.map((task, index) => (
            <li key={task.title} className={styles.previewRow} data-current={String(index === 0)}>
              <span className={styles.previewBox}>
                <Check aria-hidden="true" />
              </span>
              <span>
                <span className={styles.previewTitle}>{task.title}</span>
                <span className={styles.previewMeta} data-high={String(task.high)}>
                  {task.high ? <Flag aria-hidden="true" /> : null}
                  {task.meta}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.previewNote}>
          <p className={styles.previewNoteTitle}>Send the revised proposal</p>
          <p>Include the updated timeline and final estimates.</p>
          <p>Keep the next step clear.</p>
        </div>
      </div>
      <div className={styles.previewFoot}>
        <span>
          <ChevronRight aria-hidden="true" />
          Completed
        </span>
        <span>1</span>
      </div>
    </figure>
  );
}

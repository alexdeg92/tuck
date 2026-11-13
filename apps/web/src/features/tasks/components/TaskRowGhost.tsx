import { Flag, GripVertical, MoreHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { formatDueDate, formatPriority } from '../../../shared/lib/format';
import { usePhoneTier } from '../../../shared/lib/usePhoneTier';
import { CheckGlyph } from '../../../shared/ui/CheckGlyph';
import type { Ghost } from '../presence';
import styles from './TaskRow.module.css';

export function TaskRowGhost({ ghost }: { ghost: Ghost }) {
  const phone = usePhoneTier();
  const slot = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    slot.current?.style.setProperty('--ghost-from-x', `${String(ghost.fromX)}px`);
  }, [ghost.fromX]);
  const { task } = ghost;
  const done = task.status === 'done';
  const dueLabel = formatDueDate(task.dueDate);
  return (
    <li
      ref={slot}
      className={cx(recipes.rowSlot, phone && styles.touchRow)}
      data-presence={ghost.key}
      data-phase={ghost.phase}
      data-exit={ghost.exit}
      aria-hidden="true"
      inert
    >
      <div className={cx(recipes.rowClip, phone && styles.swipeClip)}>
        <div
          className={cx(recipes.material, recipes.taskRow, phone && styles.swipeSurface)}
          data-selected="false"
          data-done={String(done)}
          data-dragging="false"
        >
          <span className={cx(recipes.rowGrip, styles.grip)}>
            <GripVertical aria-hidden="true" />
          </span>
          <span className={recipes.rowCheck}>
            <span className={recipes.checkControl}>
              <input
                className={recipes.checkInput}
                type="checkbox"
                checked={done}
                readOnly
                tabIndex={-1}
              />
              <span className={cx(recipes.material, recipes.checkbox)}>
                <CheckGlyph />
              </span>
            </span>
          </span>
          <span className={cx(recipes.taskLink, styles.link)}>
            <span className={recipes.taskTitle}>{task.title}</span>
          </span>
          <div className={recipes.rowMeta}>
            {ghost.exit === 'complete' && ghost.group === 'open' ? (
              <span className={recipes.rowResult}>Completed</span>
            ) : null}
            {task.priority === 'medium' ? null : (
              <span
                className={cx(recipes.material, recipes.priorityBadge)}
                data-priority={task.priority}
              >
                {task.priority === 'high' ? <Flag aria-hidden="true" /> : null}
                <span>{formatPriority(task.priority)}</span>
              </span>
            )}
            {dueLabel !== null && dueLabel !== '' ? (
              <span className={recipes.rowDate}>{dueLabel}</span>
            ) : null}
          </div>
          {phone ? (
            <span className={styles.rowOptions}>
              <span className={cx('rowMore', styles.rowMore)}>
                <MoreHorizontal aria-hidden="true" className="flowIcon" />
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

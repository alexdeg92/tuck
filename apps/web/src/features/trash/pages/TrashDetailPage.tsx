import { RotateCcw, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { formatDueDate, formatPriority } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { BackLink, FrameBody, FrameHead, Pane } from '../../../shared/ui/Frame';
import { SkeletonList } from '../../../shared/ui/States';
import { PurgeDate } from '../components/PurgeDate';
import { TrashPlaceholder } from '../components/TrashPlaceholder';
import { useTrash } from '../hooks';
import { useTrashActions } from '../useTrashActions';

/** Read from the trash list: the task and checklist routes answer 404 for a trashed task. */
export function TrashDetailPage() {
  const { id } = useParams();
  const trash = useTrash();
  const navigate = useNavigate();
  const actions = useTrashActions({
    onDone: () => {
      void navigate('/trash');
    },
  });
  const task = trash.data?.items.find((item) => item.id === id);

  if (trash.isPending) {
    return (
      <Pane pane="detail" label="Trashed task" className={cx(recipes.material, recipes.panel)}>
        <SkeletonList rows={3} />
      </Pane>
    );
  }
  if (task === undefined) return <TrashPlaceholder message="This task is no longer in Trash." />;

  const due = formatDueDate(task.dueDate);
  const { done, total } = task.checklist;

  return (
    <Pane
      pane="detail"
      label="Trashed task"
      className={cx(recipes.material, recipes.panel, 'notesFrame')}
    >
      <FrameHead
        className={cx(recipes.material, recipes.frameHead, recipes.detailHead, 'notesHead')}
      >
        <BackLink to="/trash">Trash</BackLink>
        <Button
          variant="secondary"
          disabled={actions.pendingId === task.id}
          aria-busy={actions.pendingId === task.id}
          onClick={() => {
            actions.restore(task);
          }}
        >
          <RotateCcw className={recipes.buttonIcon} aria-hidden="true" />
          <span className={recipes.label}>Restore</span>
        </Button>
        <button
          type="button"
          className="plainIcon"
          aria-label={`Delete “${task.title}” forever`}
          title="Delete forever"
          onClick={() => {
            actions.askDeleteForever(task);
          }}
        >
          <Trash2 aria-hidden="true" className="flowIcon" />
        </button>
      </FrameHead>
      <FrameBody className="notesBody">
        <article className="noteCanvas trashDetail">
          <h2 className="noteHeading">{task.title}</h2>
          <p className="trashMeta">
            <span>{formatPriority(task.priority)} priority</span>
            {due !== null ? <span>{due}</span> : null}
            <span>{task.status === 'done' ? 'Completed' : 'Open'}</span>
            <PurgeDate purgeAt={task.purgeAt} />
          </p>
          {task.notes !== '' ? <p className="trashNotes">{task.notes}</p> : null}
          {total > 0 ? (
            <p>{`${String(done)} of ${String(total)} checklist items complete`}</p>
          ) : null}
          <p className="noteStatus">Restore this task to edit it or view its checklist.</p>
          {actions.error !== null ? <p role="alert">{actions.error}</p> : null}
        </article>
      </FrameBody>
      {actions.dialog}
    </Pane>
  );
}

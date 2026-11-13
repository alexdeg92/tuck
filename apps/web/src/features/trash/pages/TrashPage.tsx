import { ArrowLeft, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Outlet, useMatch, useNavigate } from 'react-router';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { Button } from '../../../shared/ui/Button';
import { AppBar, AppShell, FrameBody, FrameHead, Pane, Workspace } from '../../../shared/ui/Frame';
import { ErrorState, SkeletonList } from '../../../shared/ui/States';
import { VersionFooter } from '../../../shared/ui/VersionFooter';
import { PurgeDate } from '../components/PurgeDate';
import { TrashActions } from '../components/TrashActions';
import { TrashPlaceholder } from '../components/TrashPlaceholder';
import { useTrash } from '../hooks';
import { useTrashActions } from '../useTrashActions';

export function TrashPage({ account }: { account?: ReactNode }) {
  const trash = useTrash();
  const match = useMatch('/trash/:id');
  const navigate = useNavigate();
  const actions = useTrashActions({
    onDone: () => {
      if (match !== null) void navigate('/trash');
    },
  });
  const items = trash.data?.items ?? [];

  return (
    <AppShell>
      <AppBar>{account}</AppBar>
      <Workspace detailOpen={match !== null}>
        <Pane pane="master" label="Trash">
          <FrameHead className="masterHead trashHead">
            <Link className={cx('backToTasks', 'plainIcon')} to="/tasks">
              <ArrowLeft aria-hidden="true" className="flowIcon" />
              <span>Tasks</span>
            </Link>
            <h1 className={recipes.pageTitle}>Trash</h1>
            {items.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  actions.askEmpty(items.length);
                }}
              >
                <span className={recipes.label}>Empty trash</span>
              </Button>
            ) : null}
            <p className="trashHelper">Tasks are kept here for 30 days.</p>
          </FrameHead>
          <FrameBody className="masterBody">
            {actions.error !== null ? (
              <p className="trashError" role="alert">
                {actions.error}
              </p>
            ) : null}
            {trash.isPending ? <SkeletonList rows={4} /> : null}
            {trash.isError ? (
              <ErrorState
                message="Couldn't load Trash"
                onRetry={() => {
                  void trash.refetch();
                }}
              />
            ) : null}
            {trash.isSuccess && items.length === 0 ? (
              <div className="trashEmpty">
                <Trash2 aria-hidden="true" className="flowIcon" />
                <strong>Trash is empty</strong>
                <p>Moved tasks will appear here for 30 days.</p>
                <Link to="/tasks">Back to tasks</Link>
              </div>
            ) : null}
            {items.length > 0 ? (
              <ul className={cx(recipes.taskList, 'refinedList')} aria-label="Trashed tasks">
                {items.map((task) => (
                  <li
                    key={task.id}
                    className="trashRow"
                    data-done={task.status === 'done' ? 'true' : undefined}
                  >
                    <Link
                      className="trashLink"
                      to={`/trash/${task.id}`}
                      aria-current={match?.params.id === task.id ? 'page' : undefined}
                    >
                      <span className={recipes.taskTitle}>{task.title}</span>
                      <PurgeDate purgeAt={task.purgeAt} />
                    </Link>
                    <TrashActions
                      task={task}
                      pending={actions.pendingId === task.id}
                      onRestore={() => {
                        actions.restore(task);
                      }}
                      onDeleteForever={() => {
                        actions.askDeleteForever(task);
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </FrameBody>
        </Pane>
        {match !== null ? <Outlet /> : <TrashPlaceholder />}
      </Workspace>
      <VersionFooter />
      {actions.dialog}
    </AppShell>
  );
}

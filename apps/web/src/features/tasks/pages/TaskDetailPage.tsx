import { TaskId } from '@todo/contracts';
import { Navigate, useParams, useSearchParams } from 'react-router';
import { isApiRequestError } from '../../../shared/lib/apiError';
import { Button } from '../../../shared/ui/Button';
import { ErrorState, SkeletonList } from '../../../shared/ui/States';
import { TaskNotesPane } from '../components/TaskNotesPane';
import { useDeletedTaskIds, useTask } from '../hooks';
import type { NotesSearch, NotesSlots } from '../searchSlots';

export function TaskDetailPage({
  ownerId,
  search: Search,
}: { ownerId?: string | undefined; search?: NotesSearch } = {}) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const parsedId = TaskId.safeParse(id);
  const taskQueryId = parsedId.success ? parsedId.data : '00000000-0000-4000-8000-000000000000';
  const task = useTask(taskQueryId);
  const deletedIds = useDeletedTaskIds();
  const backTo = q === '' ? '/tasks' : `/tasks?q=${encodeURIComponent(q)}`;

  if (parsedId.success && deletedIds.includes(parsedId.data)) {
    return <Navigate to={backTo} replace />;
  }

  const refused =
    task.isError &&
    isApiRequestError(task.error) &&
    (task.error.status === 404 || task.error.status === 403);
  const shown = parsedId.success && !refused ? task.data : undefined;

  let fallback = null;
  let notice = null;
  if (!parsedId.success) {
    fallback = (
      <ErrorState
        message="Invalid task id"
        onRetry={() => {
          window.history.back();
        }}
      />
    );
  } else if (task.isError && shown !== undefined) {
    notice = (
      <p className="noteStatus" role="status">
        Couldn’t refresh this task.{' '}
        <Button
          variant="ghost"
          onClick={() => {
            void task.refetch();
          }}
        >
          Retry
        </Button>
      </p>
    );
  } else if (task.isError) {
    fallback = (
      <ErrorState
        message={task.error.message || 'Could not load task'}
        onRetry={() => {
          void task.refetch();
        }}
      />
    );
  } else if (task.isLoading) {
    fallback = <SkeletonList rows={4} />;
  }

  const pane = (slots: NotesSlots) => (
    <TaskNotesPane
      task={shown}
      backTo={backTo}
      fallback={fallback}
      notice={notice}
      ownerId={ownerId}
      {...slots}
    />
  );
  return Search === undefined ? (
    pane({})
  ) : (
    <Search task={shown} q={q}>
      {pane}
    </Search>
  );
}

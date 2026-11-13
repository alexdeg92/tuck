import type { TrashedTask } from '@todo/contracts';
import { RotateCcw, Trash2 } from 'lucide-react';

/** The two row actions: siblings of the row's link, never nested in it. */
export function TrashActions({
  task,
  pending,
  onRestore,
  onDeleteForever,
}: {
  task: TrashedTask;
  pending: boolean;
  onRestore: () => void;
  onDeleteForever: () => void;
}) {
  return (
    <span className="trashActions">
      <button
        type="button"
        className="plainIcon"
        aria-label={`Restore “${task.title}”`}
        title="Restore"
        disabled={pending}
        aria-busy={pending}
        onClick={onRestore}
      >
        <RotateCcw aria-hidden="true" className="flowIcon" />
      </button>
      <button
        type="button"
        className="plainIcon"
        aria-label={`Delete “${task.title}” forever`}
        title="Delete forever"
        disabled={pending}
        onClick={onDeleteForever}
      >
        <Trash2 aria-hidden="true" className="flowIcon" />
      </button>
    </span>
  );
}

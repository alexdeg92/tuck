import type { TrashedTask } from '@todo/contracts';
import { useState, type ReactNode } from 'react';
import { Dialog } from '../../shared/ui/Dialog';
import { useDeleteForever, useEmptyTrash, useRestoreTask } from './hooks';

type Confirming = { kind: 'one'; task: TrashedTask } | { kind: 'all'; count: number } | null;

const IRREVERSIBLE =
  "This permanently deletes the task, its notes and its checklist. You can't undo this.";

/** The Empty trash count is a snapshot: the server empties whatever is there when confirmed. */
export function useTrashActions({ onDone }: { onDone?: () => void } = {}): {
  restore: (task: TrashedTask) => void;
  askDeleteForever: (task: TrashedTask) => void;
  askEmpty: (count: number) => void;
  pendingId: string | null;
  error: string | null;
  dialog: ReactNode;
} {
  const restoreTask = useRestoreTask();
  const deleteForever = useDeleteForever();
  const emptyTrash = useEmptyTrash();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const close = () => {
    setConfirming(null);
    setDialogError(null);
  };

  const confirm = () => {
    if (confirming === null) return;
    setDialogError(null);
    const request =
      confirming.kind === 'one'
        ? deleteForever.mutateAsync(confirming.task.id)
        : emptyTrash.mutateAsync(undefined);
    request.then(
      () => {
        close();
        onDone?.();
      },
      () => {
        setDialogError(
          confirming.kind === 'one' ? "Couldn't delete this task." : "Couldn't empty the trash.",
        );
      },
    );
  };

  const busy = deleteForever.isPending || emptyTrash.isPending;
  const dialog =
    confirming === null ? null : (
      <Dialog
        title={confirming.kind === 'one' ? 'Delete this task forever?' : 'Empty Trash?'}
        confirmLabel={
          busy
            ? confirming.kind === 'one'
              ? 'Deleting…'
              : 'Emptying…'
            : confirming.kind === 'one'
              ? 'Delete forever'
              : 'Empty trash'
        }
        danger
        busy={busy}
        onConfirm={confirm}
        onClose={() => {
          if (!busy) close();
        }}
      >
        <p>
          {confirming.kind === 'one'
            ? `“${confirming.task.title}” will be deleted. ${IRREVERSIBLE}`
            : `This deletes all ${String(confirming.count)} ${confirming.count === 1 ? 'task' : 'tasks'} currently in Trash. ${IRREVERSIBLE}`}
        </p>
        {dialogError !== null ? <p role="alert">{dialogError} Try again.</p> : null}
      </Dialog>
    );

  return {
    restore: (task) => {
      setError(null);
      restoreTask.mutateAsync(task.id).then(
        () => onDone?.(),
        () => {
          setError(`Couldn't restore “${task.title}”. It may no longer be in Trash.`);
        },
      );
    },
    askDeleteForever: (task) => {
      setConfirming({ kind: 'one', task });
    },
    askEmpty: (count) => {
      setConfirming({ kind: 'all', count });
    },
    pendingId: restoreTask.isPending ? restoreTask.variables : null,
    error,
    dialog,
  };
}

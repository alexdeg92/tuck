import type { TrashedTask } from '@todo/contracts';
import { useMemo, useState, type ReactNode } from 'react';
import { isApiRequestError } from '../../../shared/lib/apiError';
import { cx } from '../../../shared/lib/cx';
import { TrashUndoContext } from '../../../shared/lib/trashUndo';
import { NotificationItem } from '../../../shared/ui/NotificationStack';
import { UndoToast } from '../../../shared/ui/UndoToast';
import recipes from '../../../styles/recipes.module.css';
import { useRestoreTask } from '../hooks';

type Notice =
  | { kind: 'offer'; task: TrashedTask; seq: number }
  | { kind: 'restoring' | 'restored' | 'gone' | 'failed'; task: TrashedTask; seq: number };

const RESULT_DWELL_MS = 1500;

/** Lives above the routes so navigating never loses the Undo offer; Undo is a server restore. */
export function TrashUndoProvider({ children }: { children: ReactNode }) {
  const restore = useRestoreTask();
  const [notice, setNotice] = useState<Notice | null>(null);
  const value = useMemo(
    () => ({
      trashed: (task: TrashedTask) => {
        setNotice((current) => ({ kind: 'offer', task, seq: (current?.seq ?? 0) + 1 }));
      },
    }),
    [],
  );

  const undo = (task: TrashedTask, seq: number) => {
    setNotice({ kind: 'restoring', task, seq });
    restore.mutateAsync(task.id).then(
      () => {
        setNotice({ kind: 'restored', task, seq });
        setTimeout(() => {
          setNotice((current) => (current?.seq === seq ? null : current));
        }, RESULT_DWELL_MS);
      },
      (error: unknown) => {
        const gone = isApiRequestError(error) && error.status === 404;
        setNotice({ kind: gone ? 'gone' : 'failed', task, seq });
      },
    );
  };

  return (
    <TrashUndoContext.Provider value={value}>
      {children}
      {notice?.kind === 'offer' ? (
        <UndoToast
          key={notice.seq}
          label="Moved to trash"
          onUndo={() => {
            undo(notice.task, notice.seq);
          }}
          onDismiss={() => {
            setNotice((current) => (current?.kind === 'offer' ? null : current));
          }}
        />
      ) : null}
      {notice !== null && notice.kind !== 'offer' ? (
        <NotificationItem priority={10}>
          <div
            role={notice.kind === 'gone' || notice.kind === 'failed' ? 'alert' : 'status'}
            className={cx(recipes.material, recipes.toast)}
            data-kind={notice.kind === 'gone' || notice.kind === 'failed' ? 'error' : undefined}
          >
            <span className={recipes.toastCopy}>
              {notice.kind === 'restoring'
                ? 'Restoring…'
                : notice.kind === 'restored'
                  ? 'Restored'
                  : notice.kind === 'gone'
                    ? 'This task is no longer in Trash.'
                    : `Couldn't restore “${notice.task.title}”.`}
            </span>
            {notice.kind === 'failed' ? (
              <button
                type="button"
                className={cx(
                  recipes.material,
                  recipes.interactive,
                  recipes.button,
                  recipes.secondary,
                )}
                onClick={() => {
                  undo(notice.task, notice.seq);
                }}
              >
                Retry
              </button>
            ) : null}
            {notice.kind === 'gone' ? (
              <button
                type="button"
                className={cx(
                  recipes.material,
                  recipes.interactive,
                  recipes.button,
                  recipes.secondary,
                )}
                onClick={() => {
                  setNotice(null);
                }}
              >
                OK
              </button>
            ) : null}
          </div>
        </NotificationItem>
      ) : null}
    </TrashUndoContext.Provider>
  );
}

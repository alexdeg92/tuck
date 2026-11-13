import type { Task } from '@todo/contracts';
import { useCallback, useState } from 'react';
import { useDeleteTask } from './hooks';

export type RowDeletion = { send: (task: Task) => void; pending: boolean };

export function useRowDeletion(): RowDeletion & { failed: Task | null } {
  const { mutateAsync: deleteTask, isPending } = useDeleteTask();
  const [failed, setFailed] = useState<Task | null>(null);

  const send = useCallback(
    (task: Task) => {
      setFailed(null);
      deleteTask(task.id).catch(() => {
        setFailed(task);
      });
    },
    [deleteTask],
  );

  return { pending: isPending, failed, send };
}

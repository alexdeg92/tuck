import type { TrashedTask } from '@todo/contracts';
import { createContext, useContext } from 'react';

/** The one seam between features: tasks report a trashed task, the trash feature offers Undo. */
export type TrashUndo = { trashed: (task: TrashedTask) => void };

export const TrashUndoContext = createContext<TrashUndo>({ trashed: () => undefined });

export function useTrashUndo(): TrashUndo {
  return useContext(TrashUndoContext);
}

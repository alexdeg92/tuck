import { Task } from '@todo/contracts';
import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as tasksApi from './api';
import { createNoteSaver, type NoteFields, type NoteSaver, type SaveState } from './autosave';
import { draftSlot } from './drafts';
import { rememberSavedTask } from './hooks';
import { taskKeys } from './keys';

export function useNoteAutosave(
  task: Task,
  ownerId: string | undefined,
  onServerFields: (fields: Partial<NoteFields>) => void,
): { saver: NoteSaver; state: SaveState } {
  const queryClient = useQueryClient();
  const [saver] = useState(() =>
    createNoteSaver({
      task,
      drafts: ownerId === undefined ? undefined : draftSlot(ownerId, task.id),
      send: async ({ id, changes, expectedUpdatedAt, keepalive }) => {
        await queryClient.cancelQueries({ queryKey: taskKeys.detail(id) });
        return tasksApi.updateTask(id, { ...changes, expectedUpdatedAt }, { keepalive });
      },
      onSaved: (saved) => {
        rememberSavedTask(queryClient, saved);
      },
    }),
  );
  const state = useSyncExternalStore(saver.subscribe, saver.getState);

  useEffect(() => saver.register(), [saver]);

  useEffect(() => {
    const detail = hashKey(taskKeys.detail(task.id));
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryHash !== detail) return;
      const server = Task.safeParse(event.query.state.data);
      if (!server.success) return;
      const shown = saver.adopt(server.data);
      if (shown !== undefined && Object.keys(shown).length > 0) onServerFields(shown);
    });
  }, [queryClient, saver, task.id, onServerFields]);

  return { saver, state };
}

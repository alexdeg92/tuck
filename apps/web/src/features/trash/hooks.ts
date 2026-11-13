import type { TaskId } from '@todo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as trashApi from './api';
import { trashKeys } from './keys';

/** The trash, in the server's order (most recently deleted first). Refetched on focus. */
export function useTrash() {
  return useQuery({ queryKey: trashKeys.all, queryFn: trashApi.listTrash });
}

/** A trash change touches the list, search and the trash count: refetch everything once it settles. */
function useTrashMutation<V>(mutationFn: (variables: V) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: trashKeys.all,
    scope: { id: 'trash' },
    mutationFn,
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export const useRestoreTask = () => useTrashMutation((id: TaskId) => trashApi.restoreTask(id));
export const useDeleteForever = () => useTrashMutation((id: TaskId) => trashApi.deleteForever(id));
export const useEmptyTrash = () => useTrashMutation(() => trashApi.emptyTrash());

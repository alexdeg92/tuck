import {
  CreateTaskInput,
  type Task,
  type TaskId,
  type TaskList,
  type UpdateTaskInput,
} from '@todo/contracts';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { z } from 'zod';
import * as tasksApi from './api';
import { taskKeys } from './keys';
import { useTrashUndo } from '../../shared/lib/trashUndo';

type CreateTaskForm = z.input<typeof CreateTaskInput>;

function listsFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
): [readonly unknown[], TaskList][] {
  return queryClient
    .getQueriesData<TaskList>({ queryKey: taskKeys.lists() })
    .filter((entry): entry is [readonly unknown[], TaskList] => entry[1] !== undefined);
}

function mapLists(
  queryClient: ReturnType<typeof useQueryClient>,
  map: (items: Task[]) => Task[],
): void {
  for (const [key, data] of listsFromCache(queryClient)) {
    queryClient.setQueryData(key, { items: map(data.items) });
  }
}

function useSettleTasks() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.isMutating({ mutationKey: taskKeys.all }) === 1
      ? queryClient.invalidateQueries({ queryKey: taskKeys.all })
      : undefined;
}

/** Merge a partial update without writing `undefined` over required Task fields. */
function applyTaskPatch(task: Task, input: UpdateTaskInput): Task {
  return {
    ...task,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
  };
}

export function useTasks(q: string) {
  return useQuery({
    queryKey: taskKeys.list(q),
    queryFn: () => tasksApi.listTasks(q),
  });
}

function taskFromLists(
  queryClient: ReturnType<typeof useQueryClient>,
  id: TaskId,
): { task: Task; updatedAt: number } | undefined {
  let found: { task: Task; updatedAt: number } | undefined;
  for (const [key, data] of listsFromCache(queryClient)) {
    const task = data.items.find((item) => item.id === id);
    const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (task && (found === undefined || updatedAt > found.updatedAt)) found = { task, updatedAt };
  }
  return found;
}

export function useTask(id: TaskId) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => tasksApi.getTask(id),
    initialData: () => taskFromLists(queryClient, id)?.task,
    initialDataUpdatedAt: () => taskFromLists(queryClient, id)?.updatedAt,
  });
}

const tasksScope = { id: 'tasks' } as const;

export function useCreateTask() {
  const settleTasks = useSettleTasks();
  return useMutation({
    mutationKey: taskKeys.create(),
    scope: tasksScope,
    mutationFn: (input: CreateTaskForm) => tasksApi.createTask(CreateTaskInput.parse(input)),
    onSettled: settleTasks,
  });
}

function pendingCreateTitle(variables: unknown): string {
  if (typeof variables !== 'object' || variables === null || !('title' in variables)) return '';
  return typeof variables.title === 'string' ? variables.title : '';
}

export function usePendingTaskTitles(): string[] {
  return useMutationState({
    filters: { mutationKey: taskKeys.create(), status: 'pending' },
    select: (mutation) => pendingCreateTitle(mutation.state.variables),
  }).filter((title) => title.trim() !== '');
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const settleTasks = useSettleTasks();
  return useMutation({
    mutationKey: taskKeys.all,
    scope: tasksScope,
    mutationFn: ({ id, input }: { id: TaskId; input: UpdateTaskInput }) =>
      tasksApi.updateTask(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      mapLists(queryClient, (items) =>
        items.map((item) => (item.id === id ? applyTaskPatch(item, input) : item)),
      );
      queryClient.setQueryData<Task>(taskKeys.detail(id), (task) =>
        task ? applyTaskPatch(task, input) : task,
      );
    },
    onSettled: settleTasks,
  });
}

export function useToggleTaskStatus() {
  const updateTask = useUpdateTask();
  const { mutate: update, mutateAsync: updateAsync } = updateTask;

  const mutate = useCallback(
    ({ id, done }: { id: TaskId; done: boolean }) => {
      update({ id, input: { status: done ? 'done' : 'todo' } });
    },
    [update],
  );
  const mutateAsync = useCallback(
    async ({ id, done }: { id: TaskId; done: boolean }) =>
      updateAsync({ id, input: { status: done ? 'done' : 'todo' } }),
    [updateAsync],
  );
  return { ...updateTask, mutate, mutateAsync };
}

export function useMoveTask(q: string) {
  const queryClient = useQueryClient();
  const settleTasks = useSettleTasks();
  return useMutation({
    mutationKey: taskKeys.all,
    scope: tasksScope,
    mutationFn: ({ id, afterId }: { id: TaskId; afterId: TaskId | null }) =>
      tasksApi.moveTask(id, { afterId }),
    onMutate: async ({ id, afterId }) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.list(q) });
      const previous = queryClient.getQueryData<TaskList>(taskKeys.list(q));
      if (previous) {
        const items = [...previous.items];
        const fromIndex = items.findIndex((item) => item.id === id);
        if (fromIndex >= 0) {
          const [moved] = items.splice(fromIndex, 1);
          if (moved) {
            if (afterId === null) {
              items.unshift(moved);
            } else {
              const afterIndex = items.findIndex((item) => item.id === afterId);
              items.splice(afterIndex + 1, 0, moved);
            }
            queryClient.setQueryData(taskKeys.list(q), { items });
          }
        }
      }
    },
    onSettled: settleTasks,
  });
}

/** Optimistic: the Undo offer lives above the routes, so it outlives the row that started it. */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  const settleTasks = useSettleTasks();
  const { trashed } = useTrashUndo();
  return useMutation({
    mutationKey: taskKeys.remove(),
    scope: tasksScope,
    mutationFn: (id: TaskId) => tasksApi.deleteTask(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.all });
      mapLists(queryClient, (items) => items.filter((item) => item.id !== id));
      queryClient.removeQueries({ queryKey: taskKeys.detail(id) });
    },
    onSuccess: (task) => {
      trashed(task);
    },
    onSettled: settleTasks,
  });
}

export function useDeletedTaskIds(): string[] {
  return useMutationState({
    filters: { mutationKey: taskKeys.remove(), status: 'success' },
    select: (mutation) => mutation.state.variables,
  }).filter((id): id is string => typeof id === 'string');
}

export function rememberSavedTask(queryClient: ReturnType<typeof useQueryClient>, task: Task) {
  queryClient.setQueryData(taskKeys.detail(task.id), task);
  mapLists(queryClient, (items) => items.map((item) => (item.id === task.id ? task : item)));
}

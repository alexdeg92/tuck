import {
  endpoints,
  type MoveTaskInput as MoveTaskBody,
  type RequestOf,
  type Task,
  type TaskId,
  type TaskList,
  type TrashedTask,
  type UpdateTaskInput as UpdateTaskBody,
} from '@todo/contracts';
import { call, type CallOptions } from '../../shared/api/http';

type CreateTaskBody = RequestOf<typeof endpoints.createTask>['body'];

export function listTasks(q: string): Promise<TaskList> {
  return call(endpoints.listTasks, { query: { q } });
}

export function getTask(id: TaskId): Promise<Task> {
  return call(endpoints.getTask, { params: { id } });
}

export function createTask(input: CreateTaskBody): Promise<Task> {
  return call(endpoints.createTask, { body: input });
}

export function updateTask(
  id: TaskId,
  input: UpdateTaskBody,
  options?: CallOptions,
): Promise<Task> {
  return call(endpoints.updateTask, { params: { id }, body: input }, options);
}

export function deleteTask(id: TaskId): Promise<TrashedTask> {
  return call(endpoints.deleteTask, { params: { id } });
}

export function moveTask(id: TaskId, input: MoveTaskBody): Promise<Task> {
  return call(endpoints.moveTask, { params: { id }, body: input });
}

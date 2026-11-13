import { endpoints, type Task, type TaskId, type TrashList } from '@todo/contracts';
import { call } from '../../shared/api/http';

export function listTrash(): Promise<TrashList> {
  return call(endpoints.listTrash, {});
}

export function restoreTask(id: TaskId): Promise<Task> {
  return call(endpoints.restoreTask, { params: { id } });
}

export function deleteForever(id: TaskId): Promise<void> {
  return call(endpoints.deleteForever, { params: { id } });
}

export function emptyTrash(): Promise<void> {
  return call(endpoints.emptyTrash, {});
}

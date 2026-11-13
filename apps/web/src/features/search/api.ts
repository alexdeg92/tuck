import {
  endpoints,
  type Checklist,
  type SearchResult,
  type TaskHighlights,
  type TaskId,
} from '@todo/contracts';
import { call } from '../../shared/api/http';

export function search(q: string): Promise<SearchResult> {
  return call(endpoints.search, { query: { q } });
}

export function taskHighlights(id: TaskId, q: string): Promise<TaskHighlights> {
  return call(endpoints.taskHighlights, { params: { id }, query: { q } });
}

export function checklist(id: TaskId): Promise<Checklist> {
  return call(endpoints.listChecklist, { params: { id } });
}

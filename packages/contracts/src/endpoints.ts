import { z } from 'zod';
import { Credentials, SignUpInput, User } from './auth';
import {
  Checklist,
  ChecklistItem,
  ChecklistItemId,
  CreateChecklistItemInput,
  MoveChecklistItemInput,
  UpdateChecklistItemInput,
} from './checklist';
import { Health } from './health';
import { RelatedTasks, SearchQuery, SearchResult, TaskHighlights } from './search';
import {
  CreateTaskInput,
  ListTasksQuery,
  MoveTaskInput,
  Task,
  TaskDetail,
  TaskId,
  TaskList,
  UpdateTaskInput,
} from './tasks';
import { TrashedTask, TrashList } from './trash';

export type Endpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: `/api/${string}`;
  params: z.ZodType | null;
  query: z.ZodType | null;
  body: z.ZodType | null;
  status: 200 | 201 | 204;

  response: z.ZodType | null;
};

const endpoint = <const E extends Endpoint>(definition: E): E => definition;
const noInput = { params: null, query: null, body: null } as const;

export const TaskParams = z.object({ id: TaskId });
export type TaskParams = z.infer<typeof TaskParams>;

export const ChecklistItemParams = z.object({ id: TaskId, itemId: ChecklistItemId });
export type ChecklistItemParams = z.infer<typeof ChecklistItemParams>;

export const endpoints = {
  signUp: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/auth/signup',
    body: SignUpInput,
    status: 201,
    response: User,
  }),
  logIn: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/auth/login',
    body: Credentials,
    status: 200,
    response: User,
  }),
  logOut: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/auth/logout',
    status: 204,
    response: null,
  }),
  /** Ends every session of the signed-in user, on every device. */
  logOutEverywhere: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/auth/logout-all',
    status: 204,
    response: null,
  }),
  me: endpoint({ ...noInput, method: 'GET', path: '/api/auth/me', status: 200, response: User }),
  listTasks: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/tasks',
    query: ListTasksQuery,
    status: 200,
    response: TaskList,
  }),
  createTask: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/tasks',
    body: CreateTaskInput,
    status: 201,
    response: Task,
  }),
  getTask: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/tasks/:id',
    params: TaskParams,
    status: 200,
    response: TaskDetail,
  }),
  updateTask: endpoint({
    ...noInput,
    method: 'PATCH',
    path: '/api/tasks/:id',
    params: TaskParams,
    body: UpdateTaskInput,
    status: 200,
    response: TaskDetail,
  }),

  deleteTask: endpoint({
    ...noInput,
    method: 'DELETE',
    path: '/api/tasks/:id',
    params: TaskParams,
    status: 200,
    response: TrashedTask,
  }),
  listTrash: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/trash',
    status: 200,
    response: TrashList,
  }),

  restoreTask: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/tasks/:id/restore',
    params: TaskParams,
    status: 200,
    response: Task,
  }),

  deleteForever: endpoint({
    ...noInput,
    method: 'DELETE',
    path: '/api/trash/:id',
    params: TaskParams,
    status: 204,
    response: null,
  }),
  emptyTrash: endpoint({
    ...noInput,
    method: 'DELETE',
    path: '/api/trash',
    status: 204,
    response: null,
  }),
  moveTask: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/tasks/:id/move',
    params: TaskParams,
    body: MoveTaskInput,
    status: 200,
    response: Task,
  }),
  listChecklist: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/tasks/:id/checklist',
    params: TaskParams,
    status: 200,
    response: Checklist,
  }),
  addChecklistItem: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/tasks/:id/checklist',
    params: TaskParams,
    body: CreateChecklistItemInput,
    status: 201,
    response: ChecklistItem,
  }),
  updateChecklistItem: endpoint({
    ...noInput,
    method: 'PATCH',
    path: '/api/tasks/:id/checklist/:itemId',
    params: ChecklistItemParams,
    body: UpdateChecklistItemInput,
    status: 200,
    response: ChecklistItem,
  }),
  deleteChecklistItem: endpoint({
    ...noInput,
    method: 'DELETE',
    path: '/api/tasks/:id/checklist/:itemId',
    params: ChecklistItemParams,
    status: 204,
    response: null,
  }),
  moveChecklistItem: endpoint({
    ...noInput,
    method: 'POST',
    path: '/api/tasks/:id/checklist/:itemId/move',
    params: ChecklistItemParams,
    body: MoveChecklistItemInput,
    status: 200,
    response: ChecklistItem,
  }),
  search: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/search',
    query: SearchQuery,
    status: 200,
    response: SearchResult,
  }),
  relatedTasks: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/tasks/:id/related',
    params: TaskParams,
    status: 200,
    response: RelatedTasks,
  }),

  taskHighlights: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/tasks/:id/highlights',
    params: TaskParams,
    query: SearchQuery,
    status: 200,
    response: TaskHighlights,
  }),
  health: endpoint({
    ...noInput,
    method: 'GET',
    path: '/api/health',
    status: 200,
    response: Health,
  }),
} as const;

type Sent<S> = S extends z.ZodType ? z.input<S> : undefined;

type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RequestOf<E extends Endpoint> = (E['params'] extends z.ZodType
  ? { params: Sent<E['params']> }
  : { params?: never }) &
  (E['query'] extends z.ZodType ? { query: Sent<E['query']> } : { query?: never }) &
  (E['body'] extends z.ZodType ? { body: Sent<E['body']> } : { body?: never });

export type ParsedRequestOf<E extends Endpoint> = {
  params: Parsed<E['params']>;
  query: Parsed<E['query']>;
  body: Parsed<E['body']>;
};

export type ResponseOf<E extends Endpoint> = Parsed<E['response']>;

export type ReplyOf<E extends Endpoint> = E['response'] extends z.ZodType
  ? Promise<z.input<E['response']>>
  : Promise<void>;

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ApiError,
  Checklist,
  ChecklistItem,
  ChecklistItemParams,
  CreateChecklistItemInput,
  MoveChecklistItemInput,
  RelatedTasks,
  SearchQuery,
  SearchResult,
  TaskHighlights,
  UpdateChecklistItemInput,
  CreateTaskInput,
  ListTasksQuery,
  Credentials,
  SignUpInput,
  Health,
  MoveTaskInput,
  NoteDoc,
  Task,
  TaskDetail,
  TaskParams,
  TaskList,
  TrashedTask,
  TrashList,
  UpdateTaskInput,
  TaskConflictError,
  User,
} from './index';

const examplesDir = new URL('../examples/', import.meta.url);

const schemaByExample: Record<string, z.ZodType> = {
  'task.json': Task,
  'task-detail.json': TaskDetail,
  'note-doc.json': NoteDoc,
  'task-list.json': TaskList,
  'create-task.json': CreateTaskInput,
  'update-task.json': UpdateTaskInput,
  'update-task-notes.json': UpdateTaskInput,
  'move-task.json': MoveTaskInput,
  'task-params.json': TaskParams,
  'list-tasks-query.json': ListTasksQuery,
  'credentials.json': Credentials,
  'sign-up.json': SignUpInput,
  'user.json': User,
  'error-validation.json': ApiError,
  'error-not-found.json': ApiError,
  'error-task-conflict.json': TaskConflictError,
  'health.json': Health,
  'checklist.json': Checklist,
  'checklist-item.json': ChecklistItem,
  'create-checklist-item.json': CreateChecklistItemInput,
  'update-checklist-item.json': UpdateChecklistItemInput,
  'move-checklist-item.json': MoveChecklistItemInput,
  'checklist-item-params.json': ChecklistItemParams,
  'search-query.json': SearchQuery,
  'search-result.json': SearchResult,
  'related-tasks.json': RelatedTasks,
  'task-highlights.json': TaskHighlights,
  'trashed-task.json': TrashedTask,
  'trash-list.json': TrashList,
};

const readExample = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(file, examplesDir), 'utf8'));

describe('contract examples', () => {
  it('maps every example file to a schema', () => {
    expect(readdirSync(examplesDir).sort()).toEqual(Object.keys(schemaByExample).sort());
  });

  it.each(Object.entries(schemaByExample))('%s parses with its schema', (file, schema) => {
    expect(schema.safeParse(readExample(file)).success).toBe(true);
  });
});

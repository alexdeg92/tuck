import { z } from 'zod';
import { NOTE_TEXT_MAX, NoteDoc, NoteDocShape, normaliseNewlines, projectNote } from './noteDoc';
import { SearchText } from './searchText';

export const TaskId = z.uuid();
export type TaskId = z.infer<typeof TaskId>;

export const TaskStatus = z.enum(['todo', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(['low', 'medium', 'high']);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskTitle = z.string().trim().min(1).max(200);

const TaskNotes = z.string().transform(normaliseNewlines).pipe(z.string().max(NOTE_TEXT_MAX));

const DueDate = z.iso.date();

export const MIN_DUE_DATE = '1900-01-01';
export const MAX_DUE_DATE = '9999-12-31';

const DueDateInput = DueDate.refine((date) => date >= MIN_DUE_DATE && date <= MAX_DUE_DATE, {
  message: `Due date must be between ${MIN_DUE_DATE} and ${MAX_DUE_DATE}`,
});

export const Instant = z.iso.datetime();

export const ChecklistSummary = z
  .object({ done: z.number().int().min(0), total: z.number().int().min(0) })
  .refine(({ done, total }) => done <= total, { message: 'done cannot exceed total' });
export type ChecklistSummary = z.infer<typeof ChecklistSummary>;

export const Task = z.object({
  id: TaskId,
  title: TaskTitle,
  notes: TaskNotes,
  status: TaskStatus,
  priority: TaskPriority,

  dueDate: DueDate.nullable(),

  position: z.string().min(1),
  createdAt: Instant,
  updatedAt: Instant,

  completedAt: Instant.nullable().default(null),

  checklist: ChecklistSummary.default({ done: 0, total: 0 }),
});
export type Task = z.infer<typeof Task>;

/**
 * One task as GET /api/tasks/:id and PATCH return it: the task plus its formatted notes. `notes`
 * stays the plain-text projection of `notesDoc` (projectNote), so the list never carries the doc.
 * The API always sends `notesDoc`; it is optional here only until the web reads it (a client
 * built before formatted notes still parses the reply), then it becomes required.
 */
export const TaskDetail = Task.extend({ notesDoc: NoteDocShape.optional() }).refine(
  ({ notes, notesDoc }) => notesDoc === undefined || projectNote(notesDoc).text === notes,
  { message: 'notes must be the plain text of notesDoc', path: ['notes'] },
);
export type TaskDetail = z.infer<typeof TaskDetail>;

export const TaskList = z.object({ items: z.array(Task) });
export type TaskList = z.infer<typeof TaskList>;

export const CreateTaskInput = z.strictObject({
  title: TaskTitle,
  notes: TaskNotes.default(''),
  priority: TaskPriority.default('medium'),
  dueDate: DueDateInput.nullable().default(null),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const TaskChanges = z
  .strictObject({
    title: TaskTitle,
    notes: TaskNotes,
    status: TaskStatus,
    priority: TaskPriority,
    dueDate: DueDateInput.nullable(),

    notesDoc: NoteDoc,
  })
  .partial();
export type TaskChanges = z.infer<typeof TaskChanges>;

export const UpdateTaskInput = TaskChanges.extend({ expectedUpdatedAt: Instant.optional() })
  .refine(({ expectedUpdatedAt: _precondition, ...changes }) => Object.keys(changes).length > 0, {
    message: 'Provide at least one field to update',
  })
  .refine(({ notes, notesDoc }) => notes === undefined || notesDoc === undefined, {
    message: 'Send notes or notesDoc, not both',
    path: ['notesDoc'],
  })
  .refine(
    ({ notesDoc, expectedUpdatedAt }) => notesDoc === undefined || expectedUpdatedAt !== undefined,
    {
      message: 'Saving formatted notes needs expectedUpdatedAt',
      path: ['expectedUpdatedAt'],
    },
  );
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const MoveTaskInput = z.strictObject({ afterId: TaskId.nullable() });
export type MoveTaskInput = z.infer<typeof MoveTaskInput>;

export const ListTasksQuery = z.object({ q: SearchText });
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

export const TaskConflictError = z.object({
  error: z.object({ code: z.literal('CONFLICT'), message: z.string(), current: TaskDetail }),
});
export type TaskConflictError = z.infer<typeof TaskConflictError>;

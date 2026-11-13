import { z } from 'zod';
import { TaskId } from './tasks';

export const ChecklistItemId = z.uuid();
export type ChecklistItemId = z.infer<typeof ChecklistItemId>;

const ItemText = z.string().trim().min(1).max(200);
const ItemNotes = z.string().max(1000);

export const ChecklistItem = z.object({
  id: ChecklistItemId,
  taskId: TaskId,
  text: ItemText,
  notes: ItemNotes,
  done: z.boolean(),

  position: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const Checklist = z.object({ items: z.array(ChecklistItem) });
export type Checklist = z.infer<typeof Checklist>;

export const CreateChecklistItemInput = z.strictObject({
  text: ItemText,
  notes: ItemNotes.default(''),
});
export type CreateChecklistItemInput = z.infer<typeof CreateChecklistItemInput>;

export const UpdateChecklistItemInput = z
  .strictObject({ text: ItemText, notes: ItemNotes, done: z.boolean() })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateChecklistItemInput = z.infer<typeof UpdateChecklistItemInput>;

export const MoveChecklistItemInput = z.strictObject({ afterId: ChecklistItemId.nullable() });
export type MoveChecklistItemInput = z.infer<typeof MoveChecklistItemInput>;

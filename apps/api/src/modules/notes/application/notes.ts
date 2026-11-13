import {
  fromPlainText,
  type NoteDoc,
  normaliseNewlines,
  type Task,
  type TaskDetail,
} from '@todo/contracts';

import { normaliseNote } from '../domain/normalise';

export const detailOf = (task: Task, stored: NoteDoc | null): TaskDetail => {
  const notes = normaliseNewlines(task.notes);
  return {
    ...task,
    notes,
    notesDoc: stored === null ? fromPlainText(notes) : normaliseNote(stored),
  };
};

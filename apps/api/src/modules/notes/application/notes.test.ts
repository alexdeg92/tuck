import { fromPlainText, NoteDoc, TaskDetail } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { detailOf } from './notes';

const task = {
  id: '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c',
  title: 'Groceries',
  notes: 'milk\n\neggs',
  status: 'todo' as const,
  priority: 'medium' as const,
  dueDate: null,
  position: 'a0',
  createdAt: '2026-11-11T09:30:00.000Z',
  updatedAt: '2026-11-11T09:30:00.000Z',
  completedAt: null,
  checklist: { done: 0, total: 0 },
};

describe('detailOf: a task with its formatted notes', () => {
  it('reads plain notes as one paragraph per line', () => {
    expect(detailOf(task, null)).toEqual({ ...task, notesDoc: fromPlainText('milk\n\neggs') });
  });

  it('keeps a stored doc', () => {
    const stored = NoteDoc.parse({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'milk' }] }],
    });
    expect(detailOf({ ...task, notes: 'milk' }, stored).notesDoc).toEqual(stored);
  });
});

describe('detailOf with notes stored before newlines were normalised', () => {
  it('reads Windows newlines as \\n, so notes and their formatted reading agree', () => {
    const detail = TaskDetail.parse(detailOf({ ...task, notes: 'milk\r\neggs' }, null));
    expect(detail.notes).toBe('milk\neggs');
  });
});

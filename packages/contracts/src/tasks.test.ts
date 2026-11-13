import { describe, expect, it } from 'vitest';
import { fromPlainText, projectNote } from './noteDoc';
import {
  CreateTaskInput,
  ListTasksQuery,
  MAX_DUE_DATE,
  MIN_DUE_DATE,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
  TaskConflictError,
  TaskDetail,
} from './tasks';

const validTask = {
  id: '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c',
  title: 'Write tests',
  notes: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  position: 'a0',
  createdAt: '2026-11-11T09:30:00.000Z',
  updatedAt: '2026-11-11T09:30:00.000Z',
};

describe('CreateTaskInput', () => {
  it('trims the title and applies defaults', () => {
    expect(CreateTaskInput.parse({ title: '  Buy milk  ' })).toEqual({
      title: 'Buy milk',
      notes: '',
      priority: 'medium',
      dueDate: null,
    });
  });

  it.each([
    ['empty', ''],
    ['blank after trimming', '   '],
    ['longer than 200 characters', 'x'.repeat(201)],
  ])('rejects a title that is %s', (_label, title) => {
    expect(CreateTaskInput.safeParse({ title }).success).toBe(false);
  });

  it('accepts a 200-character title', () => {
    expect(CreateTaskInput.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
  });

  it('accepts notes up to 20 000 characters and rejects longer ones', () => {
    expect(CreateTaskInput.safeParse({ title: 'a', notes: 'x'.repeat(20_000) }).success).toBe(true);
    expect(CreateTaskInput.safeParse({ title: 'a', notes: 'x'.repeat(20_001) }).success).toBe(
      false,
    );
    expect(UpdateTaskInput.safeParse({ notes: 'x'.repeat(20_001) }).success).toBe(false);
  });

  it.each(['2026-13-01', '2026-02-30', '20261201', '2026-12-01T00:00:00Z', 'tomorrow'])(
    'rejects the due date %s',
    (dueDate) => {
      expect(CreateTaskInput.safeParse({ title: 'a', dueDate }).success).toBe(false);
    },
  );

  it('rejects unknown fields such as a client-chosen position', () => {
    expect(CreateTaskInput.safeParse({ title: 'a', position: 'a0' }).success).toBe(false);
  });
});

describe('UpdateTaskInput', () => {
  it('requires at least one field', () => {
    expect(UpdateTaskInput.safeParse({}).success).toBe(false);
  });

  it('accepts a single field and clearing the due date', () => {
    expect(UpdateTaskInput.parse({ dueDate: null })).toEqual({ dueDate: null });
  });

  it('takes an optional expectedUpdatedAt precondition next to a change', () => {
    expect(
      UpdateTaskInput.parse({ notes: 'n', expectedUpdatedAt: '2026-11-11T09:30:00.000Z' }),
    ).toEqual({ notes: 'n', expectedUpdatedAt: '2026-11-11T09:30:00.000Z' });
  });

  it('refuses a precondition with nothing to change, or one that is not an instant', () => {
    expect(
      UpdateTaskInput.safeParse({ expectedUpdatedAt: '2026-11-11T09:30:00.000Z' }).success,
    ).toBe(false);
    expect(UpdateTaskInput.safeParse({ notes: 'n', expectedUpdatedAt: 'yesterday' }).success).toBe(
      false,
    );
  });

  it('rejects fields the client may not set', () => {
    expect(UpdateTaskInput.safeParse({ status: 'done', position: 'a0' }).success).toBe(false);
  });

  it('rejects a status outside the closed set', () => {
    expect(UpdateTaskInput.safeParse({ status: 'archived' }).success).toBe(false);
  });
});

describe('due date range', () => {
  it('spans 1900-01-01 to 9999-12-31', () => {
    expect([MIN_DUE_DATE, MAX_DUE_DATE]).toEqual(['1900-01-01', '9999-12-31']);
  });

  it.each([MIN_DUE_DATE, MAX_DUE_DATE])('accepts the edge %s on create and update', (dueDate) => {
    expect(CreateTaskInput.parse({ title: 'a', dueDate }).dueDate).toBe(dueDate);
    expect(UpdateTaskInput.parse({ dueDate })).toEqual({ dueDate });
  });

  it.each(['1899-12-31', '0999-06-15', '0001-01-01', '10000-01-01', '+010000-01-01'])(
    'rejects %s on create and update',
    (dueDate) => {
      expect(CreateTaskInput.safeParse({ title: 'a', dueDate }).success).toBe(false);
      expect(UpdateTaskInput.safeParse({ dueDate }).success).toBe(false);
    },
  );

  it('still reads a task saved before the range existed', () => {
    expect(Task.parse({ ...validTask, dueDate: '0999-06-15' }).dueDate).toBe('0999-06-15');
  });
});

describe('MoveTaskInput', () => {
  it('accepts null to move to the top', () => {
    expect(MoveTaskInput.parse({ afterId: null })).toEqual({ afterId: null });
  });

  it('rejects an id that is not a UUID', () => {
    expect(MoveTaskInput.safeParse({ afterId: '42' }).success).toBe(false);
  });
});

describe('ListTasksQuery', () => {
  it('trims q and defaults it to an empty string', () => {
    expect(ListTasksQuery.parse({ q: '  report ' })).toEqual({ q: 'report' });
    expect(ListTasksQuery.parse({})).toEqual({ q: '' });
  });
});

describe('Task completedAt', () => {
  it('defaults to null and accepts a UTC instant', () => {
    expect(Task.parse(validTask).completedAt).toBeNull();
    expect(Task.parse({ ...validTask, completedAt: '2026-11-11T10:00:00.000Z' }).completedAt).toBe(
      '2026-11-11T10:00:00.000Z',
    );
  });

  it('rejects a completedAt that is not an instant, and keeps it out of client inputs', () => {
    expect(Task.safeParse({ ...validTask, completedAt: 'yesterday' }).success).toBe(false);
    expect(UpdateTaskInput.safeParse({ completedAt: '2026-11-11T10:00:00.000Z' }).success).toBe(
      false,
    );
  });
});

describe('Task checklist summary', () => {
  it('defaults to an empty checklist and keeps a given summary', () => {
    expect(Task.parse(validTask).checklist).toEqual({ done: 0, total: 0 });
    expect(Task.parse({ ...validTask, checklist: { done: 2, total: 5 } }).checklist).toEqual({
      done: 2,
      total: 5,
    });
  });

  it('rejects a summary with more done than total', () => {
    expect(Task.safeParse({ ...validTask, checklist: { done: 3, total: 2 } }).success).toBe(false);
  });
});

describe('Task', () => {
  it('accepts a valid task', () => {
    expect(Task.safeParse(validTask).success).toBe(true);
  });

  it('rejects a timestamp that is not a UTC instant', () => {
    expect(Task.safeParse({ ...validTask, createdAt: '2026-11-11 09:30' }).success).toBe(false);
  });
});

describe('TaskDetail (one task, with its formatted notes)', () => {
  const notesDoc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pull the numbers' }] }],
  };

  it('is a task plus notesDoc', () => {
    const detail = TaskDetail.parse({ ...validTask, notes: 'Pull the numbers', notesDoc });
    expect(detail.notesDoc).toEqual(notesDoc);
    expect(Task.parse(detail)).not.toHaveProperty('notesDoc');
  });

  it('requires the text of notesDoc to be the notes', () => {
    expect(TaskDetail.safeParse({ ...validTask, notes: 'other', notesDoc }).success).toBe(false);
  });

  it('still parses a reply without notesDoc (clients from before formatted notes)', () => {
    expect(TaskDetail.safeParse(validTask).success).toBe(true);
  });
});

describe('notes newlines', () => {
  it('stores Windows and old Mac newlines as \\n, on create and update', () => {
    expect(CreateTaskInput.parse({ title: 'a', notes: 'one\r\ntwo\rthree' }).notes).toBe(
      'one\ntwo\nthree',
    );
    expect(UpdateTaskInput.parse({ notes: 'one\r\ntwo' })).toEqual({ notes: 'one\ntwo' });
  });

  it('gives notes whose formatted reading projects back to exactly the stored text', () => {
    const pieces = ['a', 'é', '😀', ' ', '\t', '\n', '\r\n', '\r', '\n\r', 'budget'];
    let state = 3;
    const random = (max: number) => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state % (max + 1);
    };
    for (let round = 0; round < 300; round += 1) {
      const raw = Array.from({ length: random(40) }, () => pieces[random(pieces.length - 1)]).join(
        '',
      );
      const { notes } = CreateTaskInput.parse({ title: 'a', notes: raw });
      expect(projectNote(fromPlainText(notes)).text).toBe(notes);
    }
  });
});

describe('saving formatted notes (PATCH notesDoc)', () => {
  const notesDoc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Pull the numbers' }] }],
  };
  const at = '2026-11-11T09:30:00.000Z';

  it('takes notesDoc with an expectedUpdatedAt precondition', () => {
    expect(UpdateTaskInput.safeParse({ notesDoc, expectedUpdatedAt: at }).success).toBe(true);
  });

  it('requires the precondition with notesDoc, and refuses notesDoc together with notes', () => {
    expect(UpdateTaskInput.safeParse({ notesDoc }).success).toBe(false);
    expect(UpdateTaskInput.safeParse({ notesDoc, notes: 'x', expectedUpdatedAt: at }).success).toBe(
      false,
    );
  });

  it('refuses a note that is not a valid NoteDoc (an unsafe link)', () => {
    const unsafe = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    expect(UpdateTaskInput.safeParse({ notesDoc: unsafe, expectedUpdatedAt: at }).success).toBe(
      false,
    );
  });

  it('answers a conflict with the current task and its formatted notes', () => {
    const current = { ...validTask, notes: 'Pull the numbers', notesDoc };
    const reply = TaskConflictError.parse({ error: { code: 'CONFLICT', message: 'm', current } });
    expect(reply.error.current).toMatchObject({ notesDoc });
  });
});

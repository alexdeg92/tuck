import { NoteDoc, projectNote, Task, TaskConflictError, TaskDetail } from '@todo/contracts';
import { expect, it } from 'vitest';
import { makeTestApp, signedIn } from './testing';

it.each(['\r\n', '\r'])(
  'keeps formatted %j readable on save, read and stale conflict',
  async (newline) => {
    const { app, db } = makeTestApp();
    try {
      const owner = await signedIn(app, 'formatted-newlines@example.com');
      const task = Task.parse(
        (await owner.post('/api/tasks').send({ title: 'Newlines' }).expect(201)).body,
      );
      const notesDoc = NoteDoc.parse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'marked' + newline + 'text', marks: [{ type: 'bold' }] },
            ],
          },
          { type: 'codeBlock', content: [{ type: 'text', text: 'one' + newline + 'two' }] },
        ],
      });
      const saved = await owner
        .patch('/api/tasks/' + task.id)
        .send({ notesDoc, expectedUpdatedAt: task.updatedAt })
        .expect(200);
      const detail = TaskDetail.parse(saved.body);
      expect(detail.notes).toBe('marked\ntext\none\ntwo');
      expect(projectNote(NoteDoc.parse(detail.notesDoc)).text).toBe(detail.notes);
      const row = db.prepare('SELECT notes_doc FROM tasks WHERE id = ?').get(task.id) as {
        notes_doc: string;
      };
      expect(JSON.parse(row.notes_doc)).toEqual(detail.notesDoc);
      expect(TaskDetail.parse((await owner.get('/api/tasks/' + task.id).expect(200)).body)).toEqual(
        detail,
      );
      const stale = await owner
        .patch('/api/tasks/' + task.id)
        .send({ notesDoc, expectedUpdatedAt: task.updatedAt })
        .expect(409);
      expect(TaskConflictError.safeParse(stale.body).success).toBe(true);

      db.prepare('UPDATE tasks SET notes = ?, notes_doc = ? WHERE id = ?').run(
        projectNote(notesDoc).text,
        JSON.stringify(notesDoc),
        task.id,
      );
      const legacy = TaskDetail.parse((await owner.get('/api/tasks/' + task.id).expect(200)).body);
      expect(legacy.notesDoc).toEqual(detail.notesDoc);
      expect(legacy.notes).toBe(detail.notes);
      const legacyConflict = await owner
        .patch('/api/tasks/' + task.id)
        .send({ notesDoc, expectedUpdatedAt: task.updatedAt })
        .expect(409);
      expect(TaskConflictError.safeParse(legacyConflict.body).success).toBe(true);
    } finally {
      db.close();
    }
  },
);

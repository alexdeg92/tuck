import { describe, expect, it } from 'vitest';
import { TrashedTask, TrashList } from './trash';

const trashed = {
  id: '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c',
  title: 'Old idea',
  notes: '',
  status: 'todo',
  priority: 'low',
  dueDate: null,
  position: 'a0',
  createdAt: '2026-11-01T09:30:00.000Z',
  updatedAt: '2026-11-01T09:30:00.000Z',
  deletedAt: '2026-11-12T10:00:00.000Z',
  purgeAt: '2026-12-12T10:00:00.000Z',
};

describe('TrashedTask', () => {
  it('is a task plus when it was deleted and when the server will purge it', () => {
    expect(TrashedTask.parse(trashed)).toMatchObject({
      deletedAt: trashed.deletedAt,
      purgeAt: trashed.purgeAt,
      completedAt: null,
      checklist: { done: 0, total: 0 },
    });
  });

  it.each(['deletedAt', 'purgeAt'])('requires %s as an ISO instant', (key) => {
    expect(TrashedTask.safeParse({ ...trashed, [key]: null }).success).toBe(false);
    expect(TrashedTask.safeParse({ ...trashed, [key]: '2026-11-12' }).success).toBe(false);
  });
});

describe('TrashList', () => {
  it('wraps the trashed tasks in items', () => {
    expect(TrashList.parse({ items: [trashed] }).items).toHaveLength(1);
  });
});

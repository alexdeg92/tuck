import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, draftKey, draftSlot, type StoredDraft } from './drafts';

const me = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const taskId = '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c';
const draft: StoredDraft = {
  title: 'Mine',
  notes: 'typed',
  base: { title: 'Plan', notes: '', updatedAt: '2026-11-11T09:30:00.000Z' },
  rev: 1,
};

describe('draft storage (localStorage, per user and task)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('writes, reads back and removes one task’s draft under the user’s own key', () => {
    const slot = draftSlot(me, taskId);

    expect(slot.write(draft)).toBe(true);
    expect(localStorage.getItem(draftKey(me, taskId))).not.toBeNull();
    expect(slot.read()).toEqual(draft);
    expect(draftSlot(other, taskId).read()).toBeUndefined();

    slot.remove();
    expect(slot.read()).toBeUndefined();
  });

  it('reads a draft stored before revisions existed (v1) as revision 0, never discarding it', () => {
    const v1 = { title: draft.title, notes: draft.notes, base: draft.base };
    localStorage.setItem(draftKey(me, taskId), JSON.stringify(v1));

    expect(draftSlot(me, taskId).read()).toEqual({ ...v1, rev: 0 });
  });

  it('ignores a stored value that is not a valid draft or is over the contract limits', () => {
    localStorage.setItem(draftKey(me, taskId), '{not json');
    expect(draftSlot(me, taskId).read()).toBeUndefined();
    localStorage.setItem(
      draftKey(me, taskId),
      JSON.stringify({ ...draft, notes: 'x'.repeat(5001) }),
    );
    expect(draftSlot(me, taskId).read()).toBeUndefined();
  });

  it('reports a write that the browser refuses (full or blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(draftSlot(me, taskId).write(draft)).toBe(false);
  });

  it('clears every draft of one user on sign-out, and nobody else’s', () => {
    draftSlot(me, taskId).write(draft);
    draftSlot(me, '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e').write(draft);
    draftSlot(other, taskId).write(draft);
    localStorage.setItem('unrelated', 'kept');

    clearDrafts(me);

    expect(draftSlot(me, taskId).read()).toBeUndefined();
    expect(draftSlot(other, taskId).read()).toEqual(draft);
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });
});

import { Task } from '@todo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../test/fixtures';
import { ApiRequestError, unavailableError } from '../../shared/lib/apiError';
import {
  createNoteSaver,
  discardPendingSaves,
  flushPendingSaves,
  type SaveRequest,
} from './autosave';
import { draftSlot, type DraftSlot, type StoredDraft } from './drafts';

const base = Task.parse({ ...fixtures.task, title: 'Plan', notes: 'a' });
const at = (minute: number) => `2026-11-11T10:${String(minute).padStart(2, '0')}:00.000Z`;

function fakeServer() {
  const requests: (SaveRequest & {
    resolve: (task: Task) => void;
    reject: (e: unknown) => void;
  })[] = [];
  let minute = 0;
  const send = vi.fn(
    (request: SaveRequest) =>
      new Promise<Task>((resolve, reject) => {
        requests.push({ ...request, resolve, reject });
      }),
  );

  const answer = async () => {
    const request = requests.shift();
    if (!request) throw new Error('no open request');
    minute += 1;
    request.resolve({ ...base, ...request.changes, updatedAt: at(minute) });
    await vi.advanceTimersByTimeAsync(0);
  };
  const fail = async (error: unknown) => {
    const request = requests.shift();
    if (!request) throw new Error('no open request');
    request.reject(error);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { send, requests, answer, fail };
}

function conflict(current: Task) {
  return new ApiRequestError(
    409,
    { code: 'CONFLICT', message: 'This task changed since you loaded it' },
    { error: { code: 'CONFLICT', message: 'This task changed since you loaded it', current } },
  );
}

describe('createNoteSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves 700 ms after typing stops, once, with the precondition', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });

    saver.edit({ notes: 'ab' });
    await vi.advanceTimersByTimeAsync(400);
    saver.edit({ notes: 'abc' });
    await vi.advanceTimersByTimeAsync(699);
    expect(server.send).not.toHaveBeenCalled();

    expect(saver.getState()).toEqual({ kind: 'editing' });

    await vi.advanceTimersByTimeAsync(1);
    expect(saver.getState()).toEqual({ kind: 'saving' });
    expect(server.requests).toMatchObject([
      { changes: { notes: 'abc' }, expectedUpdatedAt: base.updatedAt },
    ]);
    await server.answer();
    expect(saver.getState()).toEqual({ kind: 'saved' });
  });

  it('keeps one request in flight and coalesces edits made meanwhile into the next save', async () => {
    const server = fakeServer();
    const onSaved = vi.fn();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved });

    saver.edit({ notes: 'ab' });
    void saver.flush();
    saver.edit({ notes: 'abc' });
    saver.edit({ title: 'Plan it', notes: 'abcd' });
    void saver.flush();
    expect(server.send).toHaveBeenCalledTimes(1);

    await server.answer();
    expect(server.send).toHaveBeenCalledTimes(2);

    expect(server.requests[0]).toMatchObject({
      changes: { title: 'Plan it', notes: 'abcd' },
      expectedUpdatedAt: at(1),
    });
    await server.answer();
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ notes: 'abcd' }));
    expect(saver.getState()).toEqual({ kind: 'saved' });
  });

  it('takes the server’s answer as final when nothing was typed meanwhile (no endless resaves)', async () => {
    const send = vi.fn(async () => ({ ...base, notes: 'normalised', updatedAt: at(1) }));
    const saver = createNoteSaver({ task: base, send, onSaved: vi.fn() });

    saver.edit({ notes: 'typed ' });
    await saver.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.getState()).toEqual({ kind: 'saved' });
  });

  it('sends only the fields that differ from the last saved version', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });

    saver.edit({ title: 'Plan' });
    await saver.flush();
    expect(server.send).not.toHaveBeenCalled();

    saver.edit({ notes: 'b' });
    void saver.flush();
    expect(server.requests[0]?.changes).toEqual({ notes: 'b' });
  });

  it('resends quietly when a conflict did not touch the title or notes (e.g. a priority change)', async () => {
    const server = fakeServer();
    const onSaved = vi.fn();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved });

    saver.edit({ notes: 'mine' });
    void saver.flush();
    await server.fail(conflict({ ...base, priority: 'low', updatedAt: at(30) }));

    expect(server.requests).toMatchObject([
      { changes: { notes: 'mine' }, expectedUpdatedAt: at(30) },
    ]);
    expect(saver.getState()).toEqual({ kind: 'saving' });
  });

  it('stops on a real conflict; Keep mine saves over theirs, Use theirs adopts theirs', async () => {
    const server = fakeServer();
    const onSaved = vi.fn();
    const theirs = { ...base, notes: 'theirs', updatedAt: at(30) };
    const saver = createNoteSaver({ task: base, send: server.send, onSaved });

    saver.edit({ notes: 'mine' });
    void saver.flush();
    await server.fail(conflict(theirs));
    expect(saver.getState()).toEqual({ kind: 'conflict', theirs });
    saver.edit({ notes: 'mine!' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.requests).toHaveLength(0);

    saver.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests).toMatchObject([
      { changes: { notes: 'mine!' }, expectedUpdatedAt: at(30) },
    ]);
    await server.answer();
    expect(saver.getState()).toEqual({ kind: 'saved' });

    const other = createNoteSaver({ task: base, send: server.send, onSaved });
    other.edit({ notes: 'mine' });
    void other.flush();
    await server.fail(conflict(theirs));
    expect(other.useTheirs()).toEqual({ title: 'Plan', notes: 'theirs' });
    expect(onSaved).toHaveBeenLastCalledWith(theirs);
    expect(other.getState()).toEqual({ kind: 'saved' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.requests).toHaveLength(0);
  });

  it('retries a failed save with backoff and says so; Retry sends at once', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });

    saver.edit({ notes: 'b' });
    void saver.flush();
    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    expect(saver.getState()).toEqual({ kind: 'failed' });

    await vi.advanceTimersByTimeAsync(999);
    expect(server.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.send).toHaveBeenCalledTimes(2);
    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(server.send).toHaveBeenCalledTimes(2);

    saver.retry();
    expect(server.send).toHaveBeenCalledTimes(3);
    await server.answer();
    expect(saver.getState()).toEqual({ kind: 'saved' });
  });

  it('Retry shows a pending state at once and ignores repeated presses while it is out', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    saver.edit({ notes: 'b' });
    void saver.flush();
    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));

    saver.retry();
    saver.retry();
    expect(saver.getState()).toEqual({ kind: 'retrying' });
    expect(server.send).toHaveBeenCalledTimes(2);

    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    expect(saver.getState()).toEqual({ kind: 'failed' });
    saver.retry();
    await server.answer();
    expect(saver.getState()).toEqual({ kind: 'saved' });
  });

  it('any save that starts after a failure (blur, backoff, Retry) shows the pending state, and Retry then does nothing extra', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    saver.edit({ notes: 'b' });
    void saver.flush();
    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    expect(saver.getState()).toEqual({ kind: 'failed' });

    void saver.flush();
    expect(saver.getState()).toEqual({ kind: 'retrying' });
    saver.retry();
    expect(server.send).toHaveBeenCalledTimes(2);

    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    expect(saver.getState()).toEqual({ kind: 'failed' });

    await vi.advanceTimersByTimeAsync(2000);
    expect(saver.getState()).toEqual({ kind: 'retrying' });
  });

  it('retries by itself when the server is unreachable (the client’s unavailable error)', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    saver.edit({ notes: 'b' });
    void saver.flush();

    await server.fail(unavailableError());
    expect(saver.getState()).toEqual({ kind: 'failed' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(server.send).toHaveBeenCalledTimes(2);
  });

  it('is offline when the network fails while the browser is offline, and saves when it is back', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const release = saver.register();

    saver.edit({ notes: 'b' });
    void saver.flush();
    await server.fail(new TypeError('Failed to fetch'));
    expect(saver.getState()).toEqual({ kind: 'offline' });

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(server.send).toHaveBeenCalledTimes(2);
    await server.answer();
    expect(saver.getState()).toEqual({ kind: 'saved' });
    release();
    online.mockRestore();
  });

  it('flushPendingSaves sends every registered saver at once and resolves when they settle', async () => {
    const server = fakeServer();
    const one = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    const two = createNoteSaver({
      task: { ...base, id: '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e' },
      send: server.send,
      onSaved: vi.fn(),
    });
    const releaseOne = one.register();
    const releaseTwo = two.register();
    one.edit({ notes: 'one' });
    two.edit({ notes: 'two' });

    let done = false;
    void flushPendingSaves().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.send).toHaveBeenCalledTimes(2);
    expect(done).toBe(false);
    await server.answer();
    await server.answer();
    expect(done).toBe(true);
    releaseOne();
    releaseTwo();
  });

  it('flushPendingSaves rejects when something is still unsaved, so a reload can wait', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    const release = saver.register();
    saver.edit({ notes: 'b' });

    const flushed = flushPendingSaves();
    const settled = expect(flushed).rejects.toThrow('Some notes are not saved yet');
    await vi.advanceTimersByTimeAsync(0);
    await server.fail(new ApiRequestError(500, { code: 'INTERNAL', message: 'down' }));
    await settled;

    saver.retry();
    await server.answer();
    await expect(flushPendingSaves()).resolves.toBeUndefined();
    release();
  });

  it('keeps saving after release (task switched) until its last edit is sent', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    const release = saver.register();
    saver.edit({ notes: 'typed just before switching' });

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests).toMatchObject([{ changes: { notes: 'typed just before switching' } }]);

    let done = false;
    void flushPendingSaves().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await server.answer();
    expect(done).toBe(true);
  });

  it('passes keepalive through when the page is being hidden', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    saver.edit({ notes: 'b' });
    void saver.flush({ keepalive: true });
    expect(server.requests[0]).toMatchObject({ keepalive: true });
  });

  it('waits while an IME composition is open (dead keys, accents): no timer, no flush', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });

    saver.edit({ notes: 'caf' });
    saver.setComposing(true);
    await vi.advanceTimersByTimeAsync(2000);
    await saver.flush();
    expect(server.send).not.toHaveBeenCalled();

    void saver.flush({ keepalive: true });
    expect(server.requests).toMatchObject([{ changes: { notes: 'caf' }, keepalive: true }]);
    await server.answer();

    saver.setComposing(false);
    saver.edit({ notes: 'café' });
    await vi.advanceTimersByTimeAsync(700);
    expect(server.requests).toMatchObject([{ changes: { notes: 'café' } }]);
  });

  describe('a newer server copy (adopt)', () => {
    it('updates untouched fields and the precondition, and returns what the editor should show', async () => {
      const server = fakeServer();
      const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });

      expect(saver.adopt({ ...base, title: 'Server', notes: 'srv', updatedAt: at(5) })).toEqual({
        title: 'Server',
        notes: 'srv',
      });
      saver.edit({ notes: 'srv + mine' });
      void saver.flush();
      expect(server.requests[0]).toMatchObject({
        changes: { notes: 'srv + mine' },
        expectedUpdatedAt: at(5),
      });
    });

    it('keeps an edited field the server also changed, and lets the save find the conflict', async () => {
      const server = fakeServer();
      const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
      saver.edit({ notes: 'mine' });

      expect(saver.adopt({ ...base, title: 'Server', notes: 'theirs', updatedAt: at(5) })).toEqual({
        title: 'Server',
      });
      void saver.flush();
      expect(server.requests[0]).toMatchObject({
        changes: { notes: 'mine' },
        expectedUpdatedAt: base.updatedAt,
      });
    });

    it('moves the precondition on when only other fields changed (a Task settings change)', async () => {
      const server = fakeServer();
      const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
      saver.edit({ notes: 'mine' });

      expect(saver.adopt({ ...base, priority: 'low', updatedAt: at(5) })).toEqual({});
      void saver.flush();
      expect(server.requests[0]).toMatchObject({ expectedUpdatedAt: at(5) });
    });

    it('ignores the copy it already has, and copies that arrive while a save is out', async () => {
      const server = fakeServer();
      const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
      expect(saver.adopt(base)).toBeUndefined();

      saver.edit({ notes: 'mine' });
      void saver.flush();
      expect(saver.adopt({ ...base, notes: 'echo', updatedAt: at(5) })).toBeUndefined();
    });
  });

  describe('durable drafts', () => {
    function fakeSlot(stored?: StoredDraft) {
      let value = stored;
      let failing = false;
      const slot: DraftSlot & { failWrites: () => void } = {
        read: () => value,
        write: vi.fn((draft: StoredDraft) => {
          if (failing) return false;
          value = draft;
          return true;
        }),
        remove: vi.fn(() => {
          value = undefined;
        }),
        failWrites: () => {
          failing = true;
        },
      };
      return { slot, current: () => value };
    }

    it('stores each edit with its base, and removes it only once that revision is saved', async () => {
      const server = fakeServer();
      const { slot, current } = fakeSlot();
      const saver = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: slot,
      });

      saver.edit({ notes: 'one' });
      expect(current()).toEqual({
        title: 'Plan',
        notes: 'one',
        base: { title: 'Plan', notes: 'a', updatedAt: base.updatedAt },
        rev: expect.any(Number) as number,
      });
      void saver.flush();
      saver.edit({ notes: 'one two' });
      await server.answer();

      expect(current()).toEqual({
        title: 'Plan',
        notes: 'one two',
        base: { title: 'Plan', notes: 'one', updatedAt: at(1) },
        rev: expect.any(Number) as number,
      });
      void saver.flush();
      await server.answer();
      expect(current()).toBeUndefined();
    });

    it('restores a stored draft as "restored" and saves it on its stored base', async () => {
      const server = fakeServer();
      const { slot } = fakeSlot({
        title: 'Plan',
        notes: 'from before the crash',
        base: { title: 'Plan', notes: 'a', updatedAt: base.updatedAt },
        rev: 1,
      });
      const saver = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: slot,
      });

      expect(saver.fields()).toEqual({ title: 'Plan', notes: 'from before the crash' });
      expect(saver.getState()).toEqual({ kind: 'restored' });
      const release = saver.register();
      await vi.advanceTimersByTimeAsync(0);
      expect(server.requests).toMatchObject([
        { changes: { notes: 'from before the crash' }, expectedUpdatedAt: base.updatedAt },
      ]);
      await server.answer();
      expect(saver.getState()).toEqual({ kind: 'saved' });
      release();
    });

    it('says when the device cannot keep the draft', () => {
      const server = fakeServer();
      const { slot } = fakeSlot();
      slot.failWrites();
      const saver = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: slot,
      });
      expect(saver.isDurable()).toBe(true);

      saver.edit({ notes: 'b' });
      expect(saver.isDurable()).toBe(false);
    });

    it('Use theirs and a deleted task drop the stored draft', async () => {
      const server = fakeServer();
      const { slot, current } = fakeSlot();
      const saver = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: slot,
      });
      saver.edit({ notes: 'mine' });
      void saver.flush();
      await server.fail(conflict({ ...base, notes: 'theirs', updatedAt: at(30) }));
      expect(current()).toBeDefined();

      saver.useTheirs();
      expect(current()).toBeUndefined();

      saver.edit({ notes: 'again' });
      void saver.flush();
      await server.fail(new ApiRequestError(404, { code: 'NOT_FOUND', message: 'Task not found' }));
      expect(current()).toBeUndefined();
    });
  });

  it('an older editor’s late acknowledgement never removes a newer editor’s stored draft (A→B→A)', async () => {
    const server = fakeServer();
    const owner = '11111111-1111-4111-8111-111111111111';
    try {
      const first = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: draftSlot(owner, base.id),
      });
      const releaseFirst = first.register();
      first.edit({ notes: 'a first' });
      releaseFirst();
      await vi.advanceTimersByTimeAsync(0);
      expect(server.requests).toHaveLength(1);

      const second = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: draftSlot(owner, base.id),
      });
      expect(second.fields().notes).toBe('a first');
      const releaseSecond = second.register();
      second.edit({ notes: 'a first second' });

      await server.answer();

      expect(second.fields().notes).toBe('a first second');
      expect(draftSlot(owner, base.id).read()?.notes).toBe('a first second');
      releaseSecond();
    } finally {
      localStorage.clear();
    }
  });

  it('never adopts a server copy older than the last acknowledged save (a late GET)', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    saver.edit({ notes: 'a + new' });
    void saver.flush();
    await server.answer();

    expect(saver.adopt({ ...base, notes: 'a', updatedAt: base.updatedAt })).toBeUndefined();
    expect(
      saver.adopt({ ...base, notes: 'older', updatedAt: '2000-01-01T00:00:00.000Z' }),
    ).toBeUndefined();
    expect(saver.fields().notes).toBe('a + new');
    saver.edit({ notes: 'a + new + more' });
    void saver.flush();
    expect(server.requests[0]).toMatchObject({ expectedUpdatedAt: at(1) });
  });

  it('keeps storing typing after a clock correction: revisions continue above the restored one', async () => {
    const server = fakeServer();
    const owner = '11111111-1111-4111-8111-111111111111';
    try {
      const ahead = Date.now() + 3_600_000;
      draftSlot(owner, base.id).write({
        title: 'Plan',
        notes: 'before the correction',
        base: { title: 'Plan', notes: 'a', updatedAt: base.updatedAt },
        rev: ahead,
      });
      const saver = createNoteSaver({
        task: base,
        send: server.send,
        onSaved: vi.fn(),
        drafts: draftSlot(owner, base.id),
      });

      saver.edit({ notes: 'before the correction, then more' });

      const stored = draftSlot(owner, base.id).read();
      expect(stored?.notes).toBe('before the correction, then more');
      expect(stored?.rev).toBeGreaterThan(ahead);
    } finally {
      localStorage.clear();
    }
  });

  it('an open editor never allocates a revision below another runtime’s published draft (two tabs, skewed clocks)', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';

    const freshRuntime = async () => {
      vi.resetModules();
      const autosave = await import('./autosave');
      const drafts = await import('./drafts');
      return { createNoteSaver: autosave.createNoteSaver, draftSlot: drafts.draftSlot };
    };
    const never = () => new Promise<Task>(() => undefined);
    try {
      vi.setSystemTime(new Date('2026-11-12T10:00:00.000Z'));
      const tabA = await freshRuntime();
      const a = tabA.createNoteSaver({
        task: base,
        send: never,
        onSaved: vi.fn(),
        drafts: tabA.draftSlot(owner, base.id),
      });

      vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
      const tabB = await freshRuntime();
      const b = tabB.createNoteSaver({
        task: base,
        send: never,
        onSaved: vi.fn(),
        drafts: tabB.draftSlot(owner, base.id),
      });
      b.edit({ notes: 'other runtime text' });

      // Back on the normal clock, the first tab types: its text must become the stored draft.
      vi.setSystemTime(new Date('2026-11-12T10:00:01.000Z'));
      a.edit({ notes: 'latest typing in this editor' });

      expect(tabA.draftSlot(owner, base.id).read()?.notes).toBe('latest typing in this editor');
    } finally {
      localStorage.clear();
    }
  });

  it('discardPendingSaves (sign-out) cancels every pending save without sending it', async () => {
    const server = fakeServer();
    const saver = createNoteSaver({ task: base, send: server.send, onSaved: vi.fn() });
    const release = saver.register();
    saver.edit({ notes: 'b' });

    discardPendingSaves();
    release();
    await vi.advanceTimersByTimeAsync(5000);

    expect(server.send).not.toHaveBeenCalled();
    await expect(flushPendingSaves()).resolves.toBeUndefined();
  });
});

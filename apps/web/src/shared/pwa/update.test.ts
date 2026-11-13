import { describe, expect, it, vi } from 'vitest';
import { createUpdateGate, hasVersionDrift } from './update';

describe('release reload gate', () => {
  it('compares real versions only', () => {
    expect(hasVersionDrift('1', '2')).toBe(true);
    expect(hasVersionDrift('1', '1')).toBe(false);
    expect(hasVersionDrift('1', '')).toBe(false);
  });
  it('flushes before reloading and remembers the target', async () => {
    const events: string[] = [];
    const gate = createUpdateGate(
      sessionStorage,
      async () => {
        events.push('save');
      },
      () => {
        events.push('reload');
      },
    );
    await gate('unit-release');
    await gate('unit-release');
    expect(events).toEqual(['save', 'reload']);
    const reload = vi.fn();
    await createUpdateGate(sessionStorage, async () => {}, reload)('unit-release');
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not reload or consume the guard on failed saves', async () => {
    const reload = vi.fn();
    const gate = createUpdateGate(
      sessionStorage,
      () => Promise.reject(new Error('offline')),
      reload,
    );
    await expect(gate('failed-release')).rejects.toThrow('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tuck:reload:failed-release')).toBeNull();
  });
});

it('registers and unregisters independent pending saves', async () => {
  const { registerPendingSave, flushPendingSaves } = await import('./update');
  const save = vi.fn().mockResolvedValue(undefined);
  const remove = registerPendingSave(save);
  await flushPendingSaves();
  expect(save).toHaveBeenCalledOnce();
  remove();
  await flushPendingSaves();
  expect(save).toHaveBeenCalledOnce();
});

it('retries a stale shell with backoff but never more than three times', async () => {
  let now = 100_000;
  const reload = vi.fn();
  const gate = () =>
    createUpdateGate(
      sessionStorage,
      async () => {},
      reload,
      () => now,
    );
  await gate()('rolling-release');
  await gate()('rolling-release');
  expect(reload).toHaveBeenCalledTimes(1);
  now += 30_000;
  await gate()('rolling-release');
  now += 59_999;
  await gate()('rolling-release');
  expect(reload).toHaveBeenCalledTimes(2);
  now += 1;
  await gate()('rolling-release');
  now += 300_000;
  await gate()('rolling-release');
  expect(reload).toHaveBeenCalledTimes(3);
});

it('blocks unsaved editor state after blur and after a failed save, then permits a saved editor', async () => {
  const { registerUnsavedGuard, flushPendingSaves } = await import('./update');
  let dirty = true;
  const unregister = registerUnsavedGuard(() => dirty);
  await expect(flushPendingSaves()).rejects.toThrow('not saved');
  await expect(flushPendingSaves()).rejects.toThrow('not saved');
  dirty = false;
  await expect(flushPendingSaves()).resolves.toBeUndefined();
  unregister();
});

it('lets explicit Reload retry during automatic cooldown, still flushing saves first', async () => {
  const version = 'manual-release';
  sessionStorage.setItem(`tuck:reload:${version}`, `3:${String(Date.now())}`);
  const flush = vi.fn().mockRejectedValueOnce(new Error('Unsaved')).mockResolvedValue(undefined);
  const reload = vi.fn();
  const gate = createUpdateGate(sessionStorage, flush, reload);
  await gate(version);
  expect(flush).not.toHaveBeenCalled();
  await expect(gate(version, true)).rejects.toThrow('Unsaved');
  expect(reload).not.toHaveBeenCalled();
  await gate(version, true);
  expect(flush).toHaveBeenCalledTimes(2);
  expect(reload).toHaveBeenCalledOnce();
});

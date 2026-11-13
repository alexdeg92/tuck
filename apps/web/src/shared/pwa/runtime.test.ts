import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchHealth } from '../api/health';
import { startPwa } from './runtime';
import {
  getReadyUpdate,
  registerPendingSave,
  registerUnsavedGuard,
  reloadReadyUpdate,
} from './update';
let stop: (() => void) | undefined;
const unregister: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

vi.mock('../api/health', () => ({ fetchHealth: vi.fn() }));
afterEach(() => {
  stop?.();
  unregister.splice(0).forEach((remove) => {
    remove();
  });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('polls health and worker updates on focus, visibility, reconnect and interval', async () => {
  vi.useFakeTimers();
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue({ update });
  const worker = new EventTarget();
  Object.assign(worker, { register });
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = { close: vi.fn() };
      port2 = {};
    },
  );
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: '' });
  stop = startPwa();
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
  expect(update).toHaveBeenCalledTimes(5);
  expect(fetchHealth).toHaveBeenCalledTimes(6);
  worker.dispatchEvent(new Event('controllerchange'));
  vi.unstubAllGlobals();
});

it('updates a focused, edited search field on pageshow without waiting for blur', async () => {
  const reload = vi.fn();
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: '' });
  stop = startPwa(reload);
  await vi.advanceTimersByTimeAsync(0);
  const search = document.createElement('input');
  search.type = 'search';
  document.body.append(search);
  search.focus();
  search.value = 'household';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: 'search-release' });
  window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(search);
  expect(reload).toHaveBeenCalledOnce();
});

it('keeps an actionable ready notice for unsaved edits and flushes again on Reload', async () => {
  let dirty = true;
  const save = vi.fn(async () => {});
  unregister.push(
    registerPendingSave(save),
    registerUnsavedGuard(() => dirty),
  );
  const reload = vi.fn();
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: 'guarded-release' });
  stop = startPwa(reload);
  await vi.advanceTimersByTimeAsync(0);
  expect(getReadyUpdate()).toBe('guarded-release');
  expect(reload).not.toHaveBeenCalled();
  await expect(reloadReadyUpdate()).rejects.toThrow('not saved');
  expect(reload).not.toHaveBeenCalled();
  dirty = false;
  await reloadReadyUpdate();
  expect(save).toHaveBeenCalledTimes(3);
  expect(reload).toHaveBeenCalledOnce();
});

it('publishes readiness while an actual pending mutation flush is unresolved', async () => {
  let finish: (() => void) | undefined;
  unregister.push(
    registerPendingSave(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const reload = vi.fn();
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: 'pending-release' });
  stop = startPwa(reload);
  await vi.advanceTimersByTimeAsync(0);
  expect(getReadyUpdate()).toBe('pending-release');
  expect(reload).not.toHaveBeenCalled();
  finish?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).toHaveBeenCalledOnce();
});

it.each(['New task title', 'Checklist item', 'Sign-up email'])(
  'defers automatic refresh for a focused non-empty %s draft, while Reload stays actionable',
  async (label) => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', label);
    input.value = 'Half typed draft';
    document.body.append(input);
    input.focus();
    const flush = vi.fn(async () => {});
    unregister.push(registerPendingSave(flush));
    const reload = vi.fn();
    vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: `draft-${label}` });
    stop = startPwa(reload);
    await vi.advanceTimersByTimeAsync(300_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getReadyUpdate()).toBe(`draft-${label}`);
    expect(reload).not.toHaveBeenCalled();
    expect(input.value).toBe('Half typed draft');
    await reloadReadyUpdate();
    expect(flush).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  },
);

it('rechecks a newly focused draft after waiting for pending saves', async () => {
  let finish: (() => void) | undefined;
  unregister.push(
    registerPendingSave(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const reload = vi.fn();
  vi.mocked(fetchHealth).mockResolvedValue({ status: 'ok', version: 'draft-during-save' });
  stop = startPwa(reload);
  await vi.advanceTimersByTimeAsync(0);
  const input = document.createElement('textarea');
  input.value = 'New draft';
  document.body.append(input);
  input.focus();
  finish?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).not.toHaveBeenCalled();
  expect(getReadyUpdate()).toBe('draft-during-save');
});

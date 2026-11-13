const saves = new Set<() => Promise<void>>();
const guards = new Set<() => boolean>();
export function registerUnsavedGuard(isDirty: () => boolean) {
  guards.add(isDirty);
  return () => {
    guards.delete(isDirty);
  };
}
export function registerPendingSave(flush: () => Promise<void>) {
  saves.add(flush);
  return () => {
    saves.delete(flush);
  };
}
export async function flushPendingSaves(): Promise<void> {
  await Promise.all([...saves].map((flush) => flush()));
  if ([...guards].some((isDirty) => isDirty())) throw new Error('Some notes are not saved yet');
}
export function hasVersionDrift(current: string, next: string) {
  return next !== '' && current !== next;
}
export function createUpdateGate(
  storage: Storage,
  flush: () => Promise<void>,
  reload: () => void,
  now = Date.now,
  deferAutomaticReload = () => false,
) {
  let running = false;
  return async (version: string, manual = false) => {
    const key = `tuck:reload:${version}`;
    const raw = storage.getItem(key);
    const [count = 0, at = 0] = (raw ?? '0:0').split(':').map(Number);

    // Explicit Reload may retry a stale shell immediately; automatic retries remain bounded.
    if (
      running ||
      (!manual &&
        (deferAutomaticReload() || count >= 3 || (count > 0 && now() - at < 30_000 * count)))
    )
      return;
    running = true;
    try {
      await flush();
      if (!manual && deferAutomaticReload()) return;
      storage.setItem(key, `${String(count + 1)}:${String(now())}`);
      storage.setItem('tuck:updated', version);
      reload();
    } finally {
      running = false;
    }
  };
}

let readyVersion: string | null = null;
let retryUpdate: (() => Promise<void>) | undefined;
const readyListeners = new Set<() => void>();
export function getReadyUpdate() {
  return readyVersion;
}
export function subscribeReadyUpdate(listener: () => void) {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}
export function setReadyUpdate(version: string | null, retry?: () => Promise<void>) {
  retryUpdate = retry;
  if (readyVersion === version) return;
  readyVersion = version;
  readyListeners.forEach((listener) => {
    listener();
  });
}
export async function reloadReadyUpdate() {
  await retryUpdate?.();
}

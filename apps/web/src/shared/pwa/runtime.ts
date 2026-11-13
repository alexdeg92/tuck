import { fetchHealth } from '../api/health';
import { createUpdateGate, flushPendingSaves, hasVersionDrift, setReadyUpdate } from './update';

function hasFocusedDraft() {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || field.matches('[type="search"], [role="searchbox"]'))
    return false;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return (
      !field.readOnly &&
      !field.disabled &&
      !field.matches(
        '[type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="hidden"]',
      ) &&
      field.value !== ''
    );
  }
  return (
    field.matches(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
    ) && field.textContent !== ''
  );
}

export function startPwa(
  reloadPage = () => {
    location.reload();
  },
) {
  const version: string = import.meta.env.VITE_APP_VERSION;
  let target: string | null = null;
  let registration: ServiceWorkerRegistration | undefined;
  const reload = createUpdateGate(
    sessionStorage,
    flushPendingSaves,
    reloadPage,
    Date.now,
    hasFocusedDraft,
  );
  const attempt = async (manual = false) => {
    if (target === null) return;
    setReadyUpdate(target, () => attempt(true));
    if (!navigator.onLine) return;
    await reload(target, manual);
  };
  const retry = () => {
    void attempt().catch(() => {
      /* The ready notice remains actionable; failed edits stay intact. */
    });
  };
  const check = async () => {
    if (document.visibilityState === 'hidden' || !navigator.onLine) return;
    try {
      await registration?.update();
      const health = await fetchHealth();
      if (hasVersionDrift(version, health.version)) target = health.version;
      else {
        sessionStorage.removeItem(`tuck:reload:${health.version}`);
        if (target === health.version) {
          target = null;
          setReadyUpdate(null);
        }
      }
      retry();
    } catch {
      // Intentionally ignored.
    }
  };
  const controllerChanged = () => {
    const controller = navigator.serviceWorker.controller;
    if (controller === null) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      channel.port1.close();
      if (typeof event.data === 'string' && event.data !== import.meta.env.VITE_BUILD_ID) {
        target = event.data;
        retry();
      }
    };
    controller.postMessage('BUILD', [channel.port2]);
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((value) => {
        registration = value;
      })
      .catch(() => {});
  }
  const checkNow = () => {
    void check();
  };
  for (const event of ['focus', 'online', 'pageshow']) window.addEventListener(event, checkNow);
  document.addEventListener('visibilitychange', checkNow);
  void check();
  const interval = setInterval(checkNow, 300_000);
  return () => {
    clearInterval(interval);
    for (const event of ['focus', 'online', 'pageshow'])
      window.removeEventListener(event, checkNow);
    document.removeEventListener('visibilitychange', checkNow);
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
    setReadyUpdate(null);
  };
}

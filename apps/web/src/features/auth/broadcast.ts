/**
 * Same-browser tabs share one session cookie, so when one tab signs out (or out everywhere, or
 * learns from a 401 that its session was revoked) the others are signed out too: this tells
 * them at once instead of waiting for their next request. Signing in tells them to look again.
 * Browsers without BroadcastChannel just fall back to the session re-check.
 */
export const AUTH_CHANNEL = 'tuck-auth';

export type AuthMessage = { type: 'signed-out' } | { type: 'signed-in' };

const isAuthMessage = (value: unknown): value is AuthMessage =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  (value.type === 'signed-out' || value.type === 'signed-in');

/**
 * One channel per tab, for sending and listening: a BroadcastChannel never delivers to the object
 * that posted, so a tab does not hear its own announcements.
 */
let channel: BroadcastChannel | null = null;
const listeners = new Set<(message: AuthMessage) => void>();

function tabChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (channel === null) {
    channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isAuthMessage(event.data)) return;
      for (const listener of listeners) listener(event.data);
    };
  }
  return channel;
}

/** Tells the other tabs of this browser. */
export function announce(message: AuthMessage): void {
  tabChannel()?.postMessage(message);
}

/** Listens to the other tabs; returns the unsubscribe (the last one closes the channel). */
export function listenToOtherTabs(listener: (message: AuthMessage) => void): () => void {
  if (tabChannel() === null) return () => undefined;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      channel?.close();
      channel = null;
    }
  };
}

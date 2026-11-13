import type { User } from '@todo/contracts';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  discardPendingSaves,
  flushPendingSaves as flushNoteSaves,
  hasUnsavedNotes,
} from '../features/tasks/autosave';
import { registerPendingSave, registerUnsavedGuard } from '../shared/pwa/update';
import { waitForPendingMutations } from './pendingMutations';
import { setIdentity } from '../features/auth/cache';
import { announce, listenToOtherTabs } from '../features/auth/broadcast';
import { sessionKeys } from '../features/auth/keys';
import { isApiRequestError, isUnavailable } from '../shared/lib/apiError';

const UNAVAILABLE_RETRY_DELAYS = [1000, 3000, 6000];
const retryWhileUnavailable = (failureCount: number, error: unknown) =>
  isUnavailable(error) && failureCount < UNAVAILABLE_RETRY_DELAYS.length;
const unavailableRetryDelay = (attempt: number) =>
  UNAVAILABLE_RETRY_DELAYS[Math.min(attempt, UNAVAILABLE_RETRY_DELAYS.length - 1)] ?? 1000;

export function createQueryClient(): QueryClient {
  const holder: { client?: QueryClient } = {};
  // Any 401 ends the session here (RequireSession then routes to sign-in). A tab that was
  // signed in also tells its sibling tabs, which share the now-refused cookie.
  const onError = (error: unknown) => {
    const client = holder.client;
    if (!client || !isApiRequestError(error) || error.status !== 401) return;
    if (client.getQueryData<User | null>(sessionKeys.me()) != null) {
      announce({ type: 'signed-out' });
    }
    void setIdentity(client, null);
  };
  holder.client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),

    defaultOptions: {
      queries: { retry: retryWhileUnavailable, retryDelay: unavailableRetryDelay },
      mutations: { retry: false },
    },
  });
  return holder.client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  useEffect(() => {
    const stopFlush = registerPendingSave(() => waitForPendingMutations(client));
    const stopGuard = registerUnsavedGuard(() => client.isMutating() > 0);

    const stopNotesFlush = registerPendingSave(() => flushNoteSaves().catch(() => undefined));
    const stopNotesGuard = registerUnsavedGuard(hasUnsavedNotes);
    // Another tab of this browser signed out (its cookie is this tab's): nothing here can be
    // saved any more, so drop it and go to sign-in now. Signed in there while signed out here: look
    // again (a signed-in tab ignores it; a new identity always follows a sign-out).
    const stopTabs = listenToOtherTabs((message) => {
      if (message.type === 'signed-out') {
        discardPendingSaves();
        void setIdentity(client, null);
      } else if (client.getQueryData<User | null>(sessionKeys.me()) == null) {
        void client.invalidateQueries({ queryKey: sessionKeys.me() });
      }
    });
    return () => {
      stopTabs();
      stopFlush();
      stopGuard();
      stopNotesFlush();
      stopNotesGuard();
    };
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isApiRequestError } from '../../shared/lib/apiError';
import * as authApi from './api';
import { announce } from './broadcast';
import { setIdentity } from './cache';
import { sessionKeys } from './keys';

/**
 * How often a visible, signed-in tab asks whether its session still stands, so a session ended
 * elsewhere (Sign out everywhere on another device) reaches this one without a refresh. Paused
 * while the tab is hidden; a tab coming back is checked at once by the session query's
 * refetch-on-focus, then on this rhythm again.
 */
export const SESSION_RECHECK_INTERVAL_MS = 30_000;

/**
 * Re-checks the session every SESSION_RECHECK_INTERVAL_MS while the tab is visible. The check is
 * passive (it never slides the session forward). A 401 ends the session here and in the other
 * tabs; an unreachable server just waits for the next check.
 */
export function useSessionWatch(intervalMs: number = SESSION_RECHECK_INTERVAL_MS): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const check = async () => {
      try {
        const user = await authApi.checkSession();
        if (!stopped) queryClient.setQueryData(sessionKeys.me(), user);
      } catch (error) {
        if (stopped || !isApiRequestError(error) || error.status !== 401) return;
        announce({ type: 'signed-out' });
        await setIdentity(queryClient, null);
      }
    };

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const sync = () => {
      stop();
      if (document.visibilityState === 'visible') {
        timer = setInterval(() => {
          void check();
        }, intervalMs);
      }
    };

    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [queryClient, intervalMs]);
}

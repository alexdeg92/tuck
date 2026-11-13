import type { Credentials, SignUpInput, User } from '@todo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as authApi from './api';
import { announce } from './broadcast';
import { setIdentity } from './cache';
import { sessionKeys } from './keys';

/**
 * Who is signed in. Refetched whenever the tab comes back into view, so a session ended
 * elsewhere is noticed on return (a 401 drops the identity: see the app's query client);
 * useSessionWatch covers a tab that stays in view.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionKeys.me(),
    queryFn: (): Promise<User> => authApi.fetchSession(),
    retry: false,
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Credentials) => authApi.login(input),
    onSuccess: async (user) => {
      await setIdentity(queryClient, user);
      announce({ type: 'signed-in' });
    },
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SignUpInput) => authApi.signUp(input),
    onSuccess: async (user) => {
      await setIdentity(queryClient, user);
      announce({ type: 'signed-in' });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: async () => {
      await setIdentity(queryClient, null);
      announce({ type: 'signed-out' });
    },
  });
}

export function useLogoutEverywhere() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logoutEverywhere(),
    onSuccess: async () => {
      await setIdentity(queryClient, null);
      announce({ type: 'signed-out' });
    },
  });
}

export { setIdentity };
export { listenToOtherTabs, announce } from './broadcast';
export { useSessionWatch, SESSION_RECHECK_INTERVAL_MS } from './useSessionWatch';

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, fixtures, jsonResponse } from '../../test/fixtures';
import { useLogin, useLogout, useLogoutEverywhere, useSession, useSignUp } from './hooks';
import { sessionKeys } from './keys';

const privateProbeKey = ['private', 'probe'] as const;

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('auth hooks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fixtures.user))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSession(), { wrapper: wrapperFor(client) });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(fixtures.user);
  });

  it('login and signup set identity and drop private caches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.includes('/signup')) return Promise.resolve(jsonResponse(fixtures.user, 201));
        return Promise.resolve(jsonResponse(fixtures.user));
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(privateProbeKey, fixtures.taskList);

    const login = renderHook(() => useLogin(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await login.result.current.mutateAsync({
        email: 'demo@example.com',
        password: 'demo1234',
      });
    });
    expect(client.getQueryData(sessionKeys.me())).toEqual(fixtures.user);
    expect(client.getQueryData(privateProbeKey)).toBeUndefined();

    client.setQueryData(privateProbeKey, fixtures.taskList);
    const signUp = renderHook(() => useSignUp(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await signUp.result.current.mutateAsync({
        email: 'demo@example.com',
        password: 'demo1234',
        confirmPassword: 'demo1234',
      });
    });
    expect(client.getQueryData(sessionKeys.me())).toEqual(fixtures.user);
    expect(client.getQueryData(privateProbeKey)).toBeUndefined();
  });

  it('logout sets a null identity and drops private caches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(emptyResponse())),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(sessionKeys.me(), fixtures.user);
    client.setQueryData(privateProbeKey, fixtures.taskList);
    const { result } = renderHook(() => useLogout(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(client.getQueryData(sessionKeys.me())).toBeNull();
    expect(client.getQueryData(privateProbeKey)).toBeUndefined();
  });

  it('sign out everywhere posts logout-all, then sets a null identity and drops private caches', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(emptyResponse()));
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(sessionKeys.me(), fixtures.user);
    client.setQueryData(privateProbeKey, fixtures.taskList);
    const { result } = renderHook(() => useLogoutEverywhere(), { wrapper: wrapperFor(client) });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/logout-all'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(client.getQueryData(sessionKeys.me())).toBeNull();
    expect(client.getQueryData(privateProbeKey)).toBeUndefined();
  });
});

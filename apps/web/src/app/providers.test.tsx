import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../features/auth/hooks';
import { sessionKeys } from '../features/auth/keys';
import { taskKeys } from '../features/tasks/keys';
import { ApiRequestError, unavailableError } from '../shared/lib/apiError';
import { fixtures, jsonResponse } from '../test/fixtures';
import { requestUrl } from '../test/url';
import { AUTH_CHANNEL } from '../features/auth/broadcast';
import { createQueryClient, Providers } from './providers';

function Probe() {
  const client = useQueryClient();

  useEffect(() => {
    client.setQueryData(sessionKeys.me(), {
      id: '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d',
      email: 'demo@example.com',
    });
    client.setQueryData(taskKeys.list(''), fixtures.taskList);
  }, [client]);

  useQuery({
    queryKey: ['probe-401'],
    queryFn: () =>
      Promise.reject(
        new ApiRequestError(401, { code: 'UNAUTHENTICATED', message: 'Sign in required' }),
      ),
    retry: false,
  });

  const session = useQuery({
    queryKey: sessionKeys.me(),
    queryFn: () => Promise.resolve(client.getQueryData(sessionKeys.me()) ?? null),
    staleTime: Infinity,
  });
  const tasks = useQuery({
    queryKey: taskKeys.list(''),
    queryFn: () => Promise.resolve(client.getQueryData(taskKeys.list('')) ?? null),
    staleTime: Infinity,
  });

  return (
    <div>
      <div data-testid="session">{session.data ? 'yes' : 'no'}</div>
      <div data-testid="tasks">{tasks.data ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('Providers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the session and private caches when a query returns 401', async () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('no'));
    await waitFor(() => expect(screen.getByTestId('tasks')).toHaveTextContent('no'));
  });

  it('purges private caches when an expired session /me returns 401', async () => {
    const detailId = fixtures.task.id;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
          );
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const client = createQueryClient();
    client.setQueryData(sessionKeys.me(), fixtures.user);
    client.setQueryData(taskKeys.list(''), fixtures.taskList);
    client.setQueryData(taskKeys.detail(detailId), fixtures.task);

    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(client.getQueryData(sessionKeys.me())).toBeNull();
    });
    expect(client.getQueryData(taskKeys.list(''))).toBeUndefined();
    expect(client.getQueryData(taskKeys.detail(detailId))).toBeUndefined();
    expect(client.isMutating()).toBe(0);
  });

  it('ends the session when a write is refused with 401 (the next action after a revocation)', async () => {
    const client = createQueryClient();
    client.setQueryData(sessionKeys.me(), fixtures.user);
    client.setQueryData(taskKeys.list(''), fixtures.taskList);
    const refused = new ApiRequestError(401, {
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(refused) })
      .execute(undefined)
      .catch(() => undefined);

    await waitFor(() => {
      expect(client.getQueryData(sessionKeys.me())).toBeNull();
    });
    expect(client.getQueryData(taskKeys.list(''))).toBeUndefined();
  });

  describe('a server that is briefly unreachable', () => {
    it('retries a query that hit it, then shows the data with no error on the way', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const client = createQueryClient();
        let calls = 0;
        const queryFn = vi.fn(async () => {
          calls += 1;
          if (calls <= 2) throw unavailableError();
          return 'ok';
        });
        const { result } = renderHook(() => useQuery({ queryKey: ['hiccup'], queryFn }), {
          wrapper: ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
          ),
        });

        await vi.advanceTimersByTimeAsync(10_000);
        await waitFor(() => {
          expect(result.current.data).toBe('ok');
        });
        expect(queryFn).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('never retries a real API error (it would only fail again)', async () => {
      const client = createQueryClient();
      const queryFn = vi.fn(async () => {
        throw new ApiRequestError(404, { code: 'NOT_FOUND', message: 'Task not found' });
      });
      const { result } = renderHook(() => useQuery({ queryKey: ['missing'], queryFn }), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it('never retries a mutation: a lost reply must not apply a write twice', async () => {
      const client = createQueryClient();
      const mutationFn = vi.fn(async () => {
        throw unavailableError();
      });
      const pending = client.getMutationCache().build(client, { mutationFn }).execute(undefined);

      await expect(pending).rejects.toBeDefined();
      expect(mutationFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('another tab of this browser', () => {
    const tabs: BroadcastChannel[] = [];
    const otherTab = () => {
      const tab = new BroadcastChannel(AUTH_CHANNEL);
      tabs.push(tab);
      return tab;
    };
    afterEach(() => {
      for (const tab of tabs.splice(0)) tab.close();
    });

    /** Shows what this tab's cache holds; seeds a signed-in session first when asked. */
    function CacheProbe({ signedIn }: { signedIn: boolean }) {
      const client = useQueryClient();
      useEffect(() => {
        if (!signedIn) return;
        client.setQueryData(sessionKeys.me(), fixtures.user);
        client.setQueryData(taskKeys.list(''), fixtures.taskList);
      }, [client, signedIn]);
      const session = useSession();
      const tasks = useQuery({
        queryKey: taskKeys.list(''),
        queryFn: () => Promise.resolve(client.getQueryData(taskKeys.list('')) ?? null),
        staleTime: Infinity,
      });
      return (
        <div>
          <div data-testid="session">{session.data ? session.data.email : 'no'}</div>
          <div data-testid="tasks">{tasks.data ? 'yes' : 'no'}</div>
        </div>
      );
    }

    it('signing out there signs this tab out at once, with no request of its own', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.user));
      vi.stubGlobal('fetch', fetchMock);
      render(
        <Providers>
          <CacheProbe signedIn />
        </Providers>,
      );
      await waitFor(() => expect(screen.getByTestId('tasks')).toHaveTextContent('yes'));
      const sent = fetchMock.mock.calls.length;

      otherTab().postMessage({ type: 'signed-out' });

      await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('no'));
      await waitFor(() => expect(screen.getByTestId('tasks')).toHaveTextContent('no'));
      expect(fetchMock.mock.calls.length).toBe(sent);
    });

    it('signing in there makes a signed-out tab look again', async () => {
      let signedIn = false;
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(
              signedIn
                ? jsonResponse(fixtures.user)
                : jsonResponse(
                    { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
                    401,
                  ),
            ),
          ),
      );
      render(
        <Providers>
          <CacheProbe signedIn={false} />
        </Providers>,
      );
      await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('no'));

      signedIn = true;
      otherTab().postMessage({ type: 'signed-in' });

      await waitFor(() =>
        expect(screen.getByTestId('session')).toHaveTextContent(fixtures.user.email),
      );
    });

    it('a 401 in a signed-in tab tells the others; one in a tab that was never signed in does not', async () => {
      const tab = otherTab();
      const heard = vi.fn();
      tab.onmessage = (event: MessageEvent<unknown>) => {
        heard(event.data);
      };
      const refused = new ApiRequestError(401, {
        code: 'UNAUTHENTICATED',
        message: 'Sign in required',
      });

      const guest = createQueryClient();
      await guest
        .fetchQuery({ queryKey: ['guest'], queryFn: () => Promise.reject(refused) })
        .catch(() => undefined);
      const member = createQueryClient();
      member.setQueryData(sessionKeys.me(), fixtures.user);
      await member
        .fetchQuery({ queryKey: ['member'], queryFn: () => Promise.reject(refused) })
        .catch(() => undefined);

      await waitFor(() => {
        expect(heard).toHaveBeenCalledTimes(1);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(heard.mock.calls).toEqual([[{ type: 'signed-out' }]]);
      expect(member.getQueryData(sessionKeys.me())).toBeNull();
    });
  });
});

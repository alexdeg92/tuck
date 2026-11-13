import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionKeys } from '../features/auth/keys';
import { SESSION_RECHECK_INTERVAL_MS } from '../features/auth/useSessionWatch';
import { draftSlot } from '../features/tasks/drafts';
import { taskKeys } from '../features/tasks/keys';
import { emptyResponse, fixtures, jsonResponse } from '../test/fixtures';
import { renderWithProviders } from '../test/query';
import { requestUrl } from '../test/url';
import { createQueryClient, Providers } from './providers';
import { AppRoutes } from './router';

function meCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call) =>
    requestUrl(call[0] as RequestInfo).includes('/api/auth/me'),
  ).length;
}

describe('AppRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows sign-in after a single anonymous /me 401 without looping', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = requestUrl(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
        );
      }
      if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <Providers>
        <MemoryRouter initialEntries={['/signin']}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    );

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() => {
      expect(meCallCount(fetchMock)).toBe(1);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(meCallCount(fetchMock)).toBe(1);
  });

  it('clears private task caches and shows sign-in when an expired session /me returns 401', async () => {
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
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const client = createQueryClient();
    client.setQueryData(sessionKeys.me(), fixtures.user);
    client.setQueryData(taskKeys.list(''), fixtures.taskList);
    client.setQueryData(taskKeys.detail(detailId), fixtures.task);

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tasks']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.queryByRole('listitem', { name: 'Draft the quarterly report' }),
    ).not.toBeInTheDocument();
    expect(client.getQueryData(taskKeys.list(''))).toBeUndefined();
    expect(client.getQueryData(taskKeys.detail(detailId))).toBeUndefined();
    expect(client.getQueryData(sessionKeys.me())).toBeNull();
  });

  it('sends unauthenticated users to sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
          );
        }
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/tasks' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
  });

  it('shows the task list for a signed-in user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(fixtures.user));
        if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(fixtures.taskList));
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/tasks' });
    expect(
      await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('banner')[0]).toHaveTextContent('Tuck');
    expect(screen.getByRole('toolbar', { name: 'Task tools' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'false');
    expect(screen.getByRole('region', { name: 'Task notes' })).toBeInTheDocument();
    // The way into the Trash, under the list (the trash list answers here with the task list).
    expect(screen.getByRole('link', { name: /^Trash/ })).toHaveAttribute('href', '/trash');
  });

  it('opens the Trash for a signed-in user, with the account bar and a way back to tasks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(fixtures.user));
        if (url.startsWith('/api/trash')) return Promise.resolve(jsonResponse(fixtures.trashList));
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/trash' });

    expect(await screen.findByRole('heading', { name: 'Trash' })).toBeInTheDocument();
    expect(await screen.findByText('Draft the quarterly report')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
  });

  it('keeps the list beside the notes when a task is open, and returns with Back', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonResponse(fixtures.user));
        if (url.startsWith(`/api/tasks/${fixtures.task.id}`)) {
          return Promise.resolve(jsonResponse(fixtures.task));
        }
        if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(fixtures.taskList));
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    renderWithProviders(<AppRoutes />, { route: '/tasks' });
    await user.click(await screen.findByRole('link', { name: 'Draft the quarterly report' }));

    expect(await screen.findByLabelText('Title')).toHaveValue('Draft the quarterly report');
    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'true');
    expect(screen.getByRole('region', { name: 'Task list' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft the quarterly report' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'false');
    expect(screen.getByRole('link', { name: 'Draft the quarterly report' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('signs out to the sign-in screen and drops private task data', async () => {
    const user = userEvent.setup();
    let authed = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        if (url.includes('/api/auth/logout') && method === 'POST') {
          authed = false;
          return Promise.resolve(emptyResponse());
        }
        if (url.includes('/api/auth/me')) {
          return authed
            ? Promise.resolve(jsonResponse(fixtures.user))
            : Promise.resolve(
                jsonResponse(
                  { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
                  401,
                ),
              );
        }
        if (url.startsWith('/api/tasks')) {
          return authed
            ? Promise.resolve(jsonResponse(fixtures.taskList))
            : Promise.resolve(
                jsonResponse(
                  { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
                  401,
                ),
              );
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    const draft = {
      title: 'Mine',
      notes: 'unsent',
      base: { title: 'Mine', notes: '', updatedAt: '2026-11-11T09:30:00.000Z' },
      rev: 1,
    };
    const someoneElse = '22222222-2222-4222-8222-222222222222';
    draftSlot(fixtures.user.id, fixtures.task.id).write(draft);
    draftSlot(someoneElse, fixtures.task.id).write(draft);

    renderWithProviders(<AppRoutes />, { route: '/tasks' });
    expect(
      await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();

    expect(draftSlot(fixtures.user.id, fixtures.task.id).read()).toBeUndefined();
    expect(draftSlot(someoneElse, fixtures.task.id).read()).toEqual(draft);
    localStorage.clear();
    expect(
      screen.queryByRole('listitem', { name: 'Draft the quarterly report' }),
    ).not.toBeInTheDocument();
  });

  it("signs out everywhere: posts logout-all, drops this user's drafts and lands on sign-in", async () => {
    const user = userEvent.setup();
    let authed = true;
    const calls: string[] = [];
    const unauthenticated = () =>
      Promise.resolve(
        jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
      );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? 'GET';
        if (method === 'POST') calls.push(url);
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        if (url.includes('/api/auth/logout-all') && method === 'POST') {
          authed = false;
          return Promise.resolve(emptyResponse());
        }
        if (url.includes('/api/auth/me')) {
          return authed ? Promise.resolve(jsonResponse(fixtures.user)) : unauthenticated();
        }
        if (url.startsWith('/api/tasks')) {
          return authed ? Promise.resolve(jsonResponse(fixtures.taskList)) : unauthenticated();
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );
    draftSlot(fixtures.user.id, fixtures.task.id).write({
      title: 'Mine',
      notes: 'unsent',
      base: { title: 'Mine', notes: '', updatedAt: '2026-11-11T09:30:00.000Z' },
      rev: 1,
    });

    renderWithProviders(<AppRoutes />, { route: '/tasks' });
    expect(
      await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
    ).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out everywhere' }));

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(calls).toContain('/api/auth/logout-all');
    expect(calls).not.toContain('/api/auth/logout');
    expect(draftSlot(fixtures.user.id, fixtures.task.id).read()).toBeUndefined();
    localStorage.clear();
  });

  describe('a session ended on another device', () => {
    function stubRevocableApi() {
      // `tasksToo: false` keeps the task list answering, so only the session check can notice.
      const state = { authed: true, tasksToo: true };
      const refused = () =>
        Promise.resolve(
          jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
        );
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        if (url.includes('/api/auth/me')) {
          return state.authed ? Promise.resolve(jsonResponse(fixtures.user)) : refused();
        }
        if (url.startsWith('/api/tasks')) {
          return state.authed || !state.tasksToo
            ? Promise.resolve(jsonResponse(fixtures.taskList))
            : refused();
        }
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      });
      vi.stubGlobal('fetch', fetchMock);
      return state;
    }

    const renderApp = () =>
      render(
        <Providers>
          <MemoryRouter initialEntries={['/tasks']}>
            <AppRoutes />
          </MemoryRouter>
        </Providers>,
      );

    it('lands on sign-in when the tab comes back into view, with no action and no reload', async () => {
      const state = stubRevocableApi();
      renderApp();
      expect(
        await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
      ).toBeInTheDocument();

      state.authed = false;
      state.tasksToo = false;
      act(() => {
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      });

      expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
      expect(
        screen.queryByRole('listitem', { name: 'Draft the quarterly report' }),
      ).not.toBeInTheDocument();
    });

    it('lands on sign-in within one re-check while the tab stays in view', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const state = stubRevocableApi();
        renderApp();
        expect(
          await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
        ).toBeInTheDocument();

        state.authed = false;
        state.tasksToo = false;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(SESSION_RECHECK_INTERVAL_MS);
        });

        expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

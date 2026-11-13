import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fixtures, jsonResponse } from '../../test/fixtures';
import { listenToOtherTabs } from './broadcast';
import { sessionKeys } from './keys';
import { SESSION_RECHECK_INTERVAL_MS, useSessionWatch } from './useSessionWatch';

const unauthenticated = () =>
  jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401);

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionKeys.me(), fixtures.user);
  client.setQueryData(['private', 'probe'], 'secret');
  const view = renderHook(
    () => {
      useSessionWatch();
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { client, ...view };
}

/** The checks sent so far, as the headers they carried. */
const checks = (fetchMock: Mock) =>
  fetchMock.mock.calls
    .filter(([url]) => String(url) === '/api/auth/me')
    .map(([, init]) => (init as RequestInit).headers as Record<string, string>);

/** Moves fake time forward and lets the check's fetch and cache writes settle. */
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useSessionWatch', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.user));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('re-checks the session every 30 s while the tab is visible, passively', async () => {
    expect(SESSION_RECHECK_INTERVAL_MS).toBe(30_000);
    setup();

    await advance(SESSION_RECHECK_INTERVAL_MS - 1);
    expect(checks(fetchMock)).toHaveLength(0);
    await advance(1);
    expect(checks(fetchMock)).toHaveLength(1);
    expect(checks(fetchMock)[0]).toMatchObject({ 'X-Session-Check': 'passive' });
    await advance(SESSION_RECHECK_INTERVAL_MS * 2);
    expect(checks(fetchMock)).toHaveLength(3);
  });

  it('pauses while the tab is hidden and restarts the rhythm when it shows again', async () => {
    setup();
    await advance(SESSION_RECHECK_INTERVAL_MS);
    expect(checks(fetchMock)).toHaveLength(1);

    setVisibility('hidden');
    await advance(SESSION_RECHECK_INTERVAL_MS * 5);
    expect(checks(fetchMock)).toHaveLength(1);

    setVisibility('visible');
    await advance(SESSION_RECHECK_INTERVAL_MS - 1);
    expect(checks(fetchMock)).toHaveLength(1);
    await advance(1);
    expect(checks(fetchMock)).toHaveLength(2);
  });

  it("on a 401 drops the identity and every private query, and tells this browser's other tabs", async () => {
    const heard = vi.fn();
    const stopListening = listenToOtherTabs(heard);
    const { client } = setup();
    fetchMock.mockResolvedValue(unauthenticated());

    await advance(SESSION_RECHECK_INTERVAL_MS);

    expect(client.getQueryData(sessionKeys.me())).toBeNull();
    expect(client.getQueryData(['private', 'probe'])).toBeUndefined();
    // The announcement goes to other tabs only: this tab's own listener never hears it.
    expect(heard).not.toHaveBeenCalled();
    stopListening();
  });

  it('keeps the session when the server cannot be reached, and checks again next time', async () => {
    const { client } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await advance(SESSION_RECHECK_INTERVAL_MS);
    expect(client.getQueryData(sessionKeys.me())).toEqual(fixtures.user);

    await advance(SESSION_RECHECK_INTERVAL_MS);
    expect(checks(fetchMock)).toHaveLength(2);
    expect(client.getQueryData(sessionKeys.me())).toEqual(fixtures.user);
  });

  it('stops checking once unmounted, even with a check in flight', async () => {
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const { client, unmount } = setup();
    await advance(SESSION_RECHECK_INTERVAL_MS);
    unmount();
    answer(unauthenticated());
    await advance(SESSION_RECHECK_INTERVAL_MS * 3);

    expect(checks(fetchMock)).toHaveLength(1);
    expect(client.getQueryData(sessionKeys.me())).toEqual(fixtures.user);
  });
});

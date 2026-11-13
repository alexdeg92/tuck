import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, fixtures, jsonResponse } from '../../test/fixtures';
import { requestUrl } from '../../test/url';
import { fetchSession, login, logout, logoutEverywhere, signUp } from './api';

describe('auth api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls session endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.includes('/logout')) return Promise.resolve(emptyResponse());
        if (url.includes('/signup')) return Promise.resolve(jsonResponse(fixtures.user, 201));
        return Promise.resolve(jsonResponse(fixtures.user));
      }),
    );

    await expect(fetchSession()).resolves.toEqual(fixtures.user);
    await expect(login({ email: 'demo@example.com', password: 'demo1234' })).resolves.toEqual(
      fixtures.user,
    );
    await expect(
      signUp({
        email: 'demo@example.com',
        password: 'demo1234',
        confirmPassword: 'demo1234',
      }),
    ).resolves.toEqual(fixtures.user);
    await expect(logout()).resolves.toBeUndefined();
    await expect(logoutEverywhere()).resolves.toBeUndefined();
  });
});

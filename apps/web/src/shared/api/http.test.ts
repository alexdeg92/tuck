import { ApiError, endpoints } from '@todo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, fixtures, jsonResponse } from '../../test/fixtures';
import { ApiRequestError, isUnavailable, UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { call } from './http';

describe('call', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends credentials same-origin and parses a success body with the contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.user));
    vi.stubGlobal('fetch', fetchMock);

    const user = await call(endpoints.me, {});

    expect(user).toEqual(fixtures.user);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: expect.objectContaining({ Accept: 'application/json' }) as HeadersInit,
      }),
    );
  });

  it('sets Content-Type when a body is present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.user));
    vi.stubGlobal('fetch', fetchMock);

    await call(endpoints.logIn, {
      body: { email: 'demo@example.com', password: 'demo1234' },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toEqual(
      expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
    );
    expect(init.body).toBe(JSON.stringify({ email: 'demo@example.com', password: 'demo1234' }));
  });

  it('builds paths with params and query from the contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.taskList));
    vi.stubGlobal('fetch', fetchMock);

    await call(endpoints.listTasks, { query: { q: 'milk' } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks?q=milk');

    fetchMock.mockResolvedValueOnce(jsonResponse(fixtures.task));
    await call(endpoints.getTask, { params: { id: fixtures.task.id } });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/tasks/${fixtures.task.id}`);
  });

  it('decodes ApiError into ApiRequestError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.errorNotFound, 404)));

    const error = await call(endpoints.getTask, {
      params: { id: '00000000-0000-4000-8000-000000000000' },
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 404,
      apiError: fixtures.errorNotFound.error,
    });
    expect(ApiError.parse({ error: (error as ApiRequestError).apiError })).toEqual(
      fixtures.errorNotFound,
    );
  });

  it('rejects a status that does not match the endpoint contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse(204)));

    await expect(call(endpoints.me, {})).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('returns undefined for 204 endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse(204)));

    await expect(call(endpoints.logOut, {})).resolves.toBeUndefined();
    await expect(
      call(endpoints.deleteForever, { params: { id: fixtures.task.id } }),
    ).resolves.toBeUndefined();
  });

  it('rejects a non-204 success for no-content endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.user)));

    await expect(call(endpoints.logOut, {})).rejects.toBeInstanceOf(ApiRequestError);
  });

  describe('when the server cannot be reached', () => {
    it.each([
      [
        'a 502 plain-text "Bad Gateway"',
        () =>
          new Response('Bad Gateway', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
      ],
      [
        'a 503 HTML page',
        () =>
          new Response('<html><body>Service Unavailable</body></html>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          }),
      ],
      ['an empty 504', () => new Response(null, { status: 504 })],
      [
        'a 200 whose body is not JSON (a proxy page)',
        () =>
          new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ],
    ])('turns %s into a friendly, typed unavailable error', async (_label, make) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));

      const failure = call(endpoints.me, {}).catch((error: unknown) => error);

      const error = await failure;
      expect(isUnavailable(error)).toBe(true);
      expect((error as Error).message).toBe(UNAVAILABLE_MESSAGE);
      expect((error as Error).message).not.toMatch(/JSON|token/i);
    });

    it('turns a network failure (offline, connection refused) into the same error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const error = await call(endpoints.me, {}).catch((failure: unknown) => failure);

      expect(isUnavailable(error)).toBe(true);
      expect((error as Error).message).toBe(UNAVAILABLE_MESSAGE);
    });

    it('keeps a real API error as it is (not unavailable)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(fixtures.errorValidation, 400)),
      );

      const error = await call(endpoints.me, {}).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(isUnavailable(error)).toBe(false);
    });
  });
});

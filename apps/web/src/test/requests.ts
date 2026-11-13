import type { Mock } from 'vitest';

type Call = [input: unknown, init?: RequestInit];

function callsWith(fetchMock: Mock, method: string): Call[] {
  return fetchMock.mock.calls.filter((call) => (call as Call)[1]?.method === method) as Call[];
}

export function sentBodies(fetchMock: Mock, method: string): unknown[] {
  return callsWith(fetchMock, method).map((call): unknown => {
    const body = call[1]?.body;
    return typeof body === 'string' ? JSON.parse(body) : undefined;
  });
}

export function didSend(fetchMock: Mock, method: string): boolean {
  return callsWith(fetchMock, method).length > 0;
}

export function bodyObject(init?: RequestInit): Record<string, unknown> {
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? Object.fromEntries(Object.entries(body))
    : {};
}

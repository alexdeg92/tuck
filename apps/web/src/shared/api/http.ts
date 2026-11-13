import { ApiError, type Endpoint, type RequestOf, type ResponseOf } from '@todo/contracts';
import { ApiRequestError, unavailableError } from '../lib/apiError';

export { ApiRequestError, isApiRequestError } from '../lib/apiError';

type Parts = { params?: unknown; query?: unknown; body?: unknown };

const entriesOf = (value: unknown): [string, unknown][] =>
  typeof value === 'object' && value !== null ? Object.entries(value) : [];

const toUrl = (endpoint: Endpoint, { params, query }: Parts): string => {
  const values = new Map(entriesOf(endpoint.params === null ? {} : endpoint.params.parse(params)));
  const path = endpoint.path.replace(/:(\w+)/g, (_match, key: string) =>
    encodeURIComponent(String(values.get(key))),
  );
  const search = new URLSearchParams(
    entriesOf(endpoint.query === null ? {} : endpoint.query.parse(query)).map(
      ([key, value]): [string, string] => [key, String(value)],
    ),
  ).toString();
  return search === '' ? path : `${path}?${search}`;
};

/**
 * `keepalive`: the request outlives the page (a save sent while the tab is being hidden).
 * `headers`: extra request headers (the passive session check's `X-Session-Check`).
 */
export type CallOptions = { keepalive?: boolean; headers?: Record<string, string> };

export function call<E extends Endpoint>(
  endpoint: E,
  request: RequestOf<E>,
  options?: CallOptions,
): Promise<ResponseOf<E>>;
export async function call(
  endpoint: Endpoint,
  request: Parts,
  { keepalive = false, headers: extra = {} }: CallOptions = {},
): Promise<unknown> {
  const body =
    endpoint.body === null ? undefined : JSON.stringify(endpoint.body.parse(request.body));
  let response: Response;
  try {
    response = await fetch(toUrl(endpoint, request), {
      method: endpoint.method,
      credentials: 'same-origin',
      ...(keepalive ? { keepalive } : {}),
      headers:
        body === undefined
          ? { ...extra, Accept: 'application/json' }
          : { ...extra, Accept: 'application/json', 'Content-Type': 'application/json' },
      // exactOptionalPropertyTypes: omit the key instead of passing body: undefined.
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw unavailableError();
  }
  if (!response.ok) {
    const errorBody = await readJson(response);
    const apiError = ApiError.safeParse(errorBody);
    if (!apiError.success) throw unavailableError(response.status);
    throw new ApiRequestError(response.status, apiError.data.error, errorBody);
  }
  if (response.status !== endpoint.status) {
    throw new ApiRequestError(response.status, {
      code: 'INTERNAL',
      message: `Expected ${String(endpoint.status)}`,
    });
  }
  if (endpoint.response === null) return undefined;
  const json = await readJson(response);
  if (json === NOT_JSON) throw unavailableError(response.status);
  return endpoint.response.parse(json);
}

const NOT_JSON = Symbol('not JSON');

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return NOT_JSON;
  }
}

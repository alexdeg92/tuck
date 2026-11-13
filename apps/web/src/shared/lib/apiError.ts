import type { ApiError as ApiErrorBody } from '@todo/contracts';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly apiError: ApiErrorBody['error'];

  readonly body: unknown;

  readonly unavailable: boolean;

  constructor(
    status: number,
    apiError: ApiErrorBody['error'],
    body?: unknown,
    unavailable = false,
  ) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.apiError = apiError;
    this.body = body;
    this.unavailable = unavailable;
  }
}

export const UNAVAILABLE_MESSAGE = 'Tuck can’t reach the server right now. Try again in a moment.';

export function unavailableError(status = 0): ApiRequestError {
  return new ApiRequestError(
    status,
    { code: 'INTERNAL', message: UNAVAILABLE_MESSAGE },
    undefined,
    true,
  );
}

export function isUnavailable(error: unknown): boolean {
  return error instanceof ApiRequestError && error.unavailable;
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

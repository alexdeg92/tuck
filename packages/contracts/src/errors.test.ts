import { describe, expect, it } from 'vitest';
import { API_ERROR_STATUS, ApiError, ApiErrorCode } from './errors';

describe('ApiError', () => {
  it('maps every code to its HTTP status', () => {
    expect(API_ERROR_STATUS).toEqual({
      VALIDATION_FAILED: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      RATE_LIMITED: 429,
      INTERNAL: 500,
    });
    expect(Object.keys(API_ERROR_STATUS)).toEqual(ApiErrorCode.options);
  });

  it('rejects an unknown code', () => {
    expect(ApiError.safeParse({ error: { code: 'TEAPOT', message: 'no' } }).success).toBe(false);
  });
});

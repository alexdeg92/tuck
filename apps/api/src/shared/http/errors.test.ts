import { describe, expect, it } from 'vitest';
import { conflict, validationFailed } from '../errors';
import { toApiError } from './errors';

const bodyParserError = (type: string, status: number) =>
  Object.assign(new Error('parser said no'), { type, status });

describe('toApiError', () => {
  it('maps an app error to its status and code', () => {
    expect(toApiError(conflict('Email already registered'))).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Email already registered' } },
    });
  });

  it('includes validation details', () => {
    const details = [{ path: 'title', message: 'Required' }];
    expect(toApiError(validationFailed('Invalid', details)).body.error.details).toEqual(details);
  });

  it.each([
    ['entity.parse.failed', 400, 'Malformed JSON body'],
    ['entity.too.large', 413, 'Request body too large'],
  ])('maps the body parser error %s to a 400', (type, status, message) => {
    expect(toApiError(bodyParserError(type, status))).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message } },
    });
  });

  it('hides everything about an unexpected error', () => {
    const { status, body } = toApiError(new Error('SQLITE_ERROR: no such table: tasks'));

    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('turns an error whose reply would break the ApiError contract into the generic 500', () => {
    const malformed = Object.assign(new Error('adapter failure'), {
      code: 'NOT_FOUND',
      details: [{ path: 7, message: 'bad' }],
    });

    expect(toApiError(malformed)).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
    });
  });
});

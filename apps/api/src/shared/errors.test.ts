import { describe, expect, it } from 'vitest';
import { conflict, isAppError, notFound, validationFailed } from './errors';

describe('app errors', () => {
  it('builds plain Errors tagged with a closed code', () => {
    const error = notFound('Task not found');

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'Task not found' });
    expect(isAppError(error)).toBe(true);
  });

  it('keeps validation details', () => {
    const details = [{ path: 'title', message: 'Required' }];
    expect(validationFailed('Invalid', details).details).toEqual(details);
  });

  it('does not mistake a system error code for an app error', () => {
    const sqliteError = Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });

    expect(isAppError(sqliteError)).toBe(false);
    expect(isAppError(conflict('Taken'))).toBe(true);
    expect(isAppError('NOT_FOUND')).toBe(false);
  });

  it('rejects an error whose details break the contract', () => {
    const malformed = Object.assign(new Error('adapter failure'), {
      code: 'NOT_FOUND',
      details: [{ path: 7, message: 'bad' }],
    });

    expect(isAppError(malformed)).toBe(false);
  });
});

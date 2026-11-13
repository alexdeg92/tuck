import {
  ApiError,
  type ApiErrorCode,
  type ApiErrorDetail,
  type NoteDoc,
  type Task,
} from '@todo/contracts';

export type AppError = Error & { readonly code: ApiErrorCode; readonly details?: ApiErrorDetail[] };

const appError = (code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): AppError =>
  Object.assign(new Error(message), details ? { code, details } : { code });

const ErrorFields = ApiError.shape.error;

export const isAppError = (error: unknown): error is AppError =>
  error instanceof Error &&
  ErrorFields.safeParse({
    code: 'code' in error ? error.code : undefined,
    message: error.message,
    details: 'details' in error ? error.details : undefined,
  }).success;

export const validationFailed = (message: string, details?: ApiErrorDetail[]): AppError =>
  appError('VALIDATION_FAILED', message, details);

export const unauthenticated = (message = 'Authentication required'): AppError =>
  appError('UNAUTHENTICATED', message);

export const notFound = (message = 'Not found'): AppError => appError('NOT_FOUND', message);

export const conflict = (message: string): AppError => appError('CONFLICT', message);

type CurrentTask = Task & { readonly notesDoc?: NoteDoc | null | undefined };

export type StaleTaskError = AppError & {
  readonly code: 'CONFLICT';
  readonly current: CurrentTask;
};

export const staleTask = (current: CurrentTask): StaleTaskError =>
  Object.assign(new Error('This task changed since you loaded it'), {
    code: 'CONFLICT' as const,
    current,
  });

export const isStaleTaskError = (error: unknown): error is StaleTaskError =>
  isAppError(error) && error.code === 'CONFLICT' && 'current' in error;

export const rateLimited = (message = 'Too many requests, try again later'): AppError =>
  appError('RATE_LIMITED', message);

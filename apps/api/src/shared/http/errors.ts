import { API_ERROR_STATUS, ApiError, TaskConflictError } from '@todo/contracts';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { type AppError, isAppError, isStaleTaskError, notFound, validationFailed } from '../errors';

const isBodyParserError = (error: unknown): error is Error & { type: string } =>
  error instanceof Error && 'type' in error && typeof error.type === 'string' && 'status' in error;

const fromBodyParser = ({ type }: { type: string }): AppError =>
  validationFailed(type === 'entity.too.large' ? 'Request body too large' : 'Malformed JSON body');

const internal: { status: number; body: ApiError } = {
  status: 500,
  body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
};

export const toApiError = (error: unknown): { status: number; body: ApiError } => {
  const appError = isBodyParserError(error) ? fromBodyParser(error) : error;
  if (!isAppError(appError)) return internal;
  if (isStaleTaskError(appError)) {
    const { code, message, current } = appError;
    const stale = TaskConflictError.safeParse({ error: { code, message, current } });
    return stale.success ? { status: API_ERROR_STATUS.CONFLICT, body: stale.data } : internal;
  }
  const { code, message, details } = appError;
  const reply = ApiError.safeParse({
    error: details === undefined ? { code, message } : { code, message, details },
  });
  return reply.success
    ? { status: API_ERROR_STATUS[reply.data.error.code], body: reply.data }
    : internal;
};

export const makeErrorHandler =
  (logError: (error: unknown) => void): ErrorRequestHandler =>
  (error: unknown, _req, res, _next) => {
    const { status, body } = toApiError(error);
    if (status === 500) logError(error);
    res.status(status).json(body);
  };

export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(notFound('Route not found'));
};

import type { RequestHandler } from 'express';
import { validationFailed } from '../errors';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Headers = Record<string, string | string[] | undefined>;

const hasBodyBytes = (headers: Headers): boolean =>
  headers['transfer-encoding'] !== undefined || Number(headers['content-length'] ?? 0) > 0;

const mediaType = (headers: Headers): string | undefined => {
  const type = headers['content-type'];
  return typeof type === 'string' ? type.split(';')[0]?.trim().toLowerCase() : undefined;
};

/**
 * Write requests carry JSON or nothing. A declared type must be application/json, even when the
 * body is empty: an empty HTML form post declares urlencoded, and HTML forms can't send JSON
 * cross-site, so this closes the form-post CSRF vector alongside SameSite cookies. A request
 * labelled JSON with an empty body (e.g. a DELETE from a generic client) is fine. With no
 * declared type, only an actual body is refused. Reported as a 400 to keep the error codes closed.
 */
export const jsonOnly: RequestHandler = (req, _res, next) => {
  const type = mediaType(req.headers);
  const rejected =
    WRITE_METHODS.has(req.method) &&
    (type === undefined ? hasBodyBytes(req.headers) : type !== 'application/json');
  next(rejected ? validationFailed('Request body must be application/json') : undefined);
};

import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { PASSIVE_SESSION_CHECK, SESSION_CHECK_HEADER } from '@todo/contracts';
import type { makeAuthenticate, SessionToken } from '../application';

export const SESSION_COOKIE = 'session';

const cookieOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure,
  path: '/',
});

/** The cookie lives exactly as long as the token it holds. */
export const setSessionCookie = (
  res: Response,
  { token, expiresAt }: SessionToken,
  now: Date,
  secure: boolean,
): void => {
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(secure),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
};

/** Clearing must repeat the attributes the cookie was set with, or browsers keep it. */
export const clearSessionCookie = (res: Response, secure: boolean): void => {
  res.clearCookie(SESSION_COOKIE, cookieOptions(secure));
};

const readSessionCookie = (req: Request): string | undefined => {
  const value: unknown = (req.cookies as Record<string, unknown>)[SESSION_COOKIE];
  return typeof value === 'string' ? value : undefined;
};

type RequireAuthDeps = {
  authenticate: ReturnType<typeof makeAuthenticate>;
  clock: () => Date;
  cookieSecure: boolean;
};

/**
 * Resolves the session cookie to a user (or 401) and exposes it as res.locals.user. A refused
 * cookie (expired, revoked) is cleared with the 401; a token due for renewal comes back as a
 * fresh cookie on this response (sliding session), unless the request is a passive session check
 * (a background poll is not the user at work).
 */
export const makeRequireAuth =
  ({ authenticate, clock, cookieSecure }: RequireAuthDeps): RequestHandler =>
  async (req, res, next) => {
    const token = readSessionCookie(req);
    try {
      const { user, renewed } = await authenticate(token);
      res.locals.user = user;
      const passive = req.get(SESSION_CHECK_HEADER) === PASSIVE_SESSION_CHECK;
      if (renewed && !passive) setSessionCookie(res, renewed, clock(), cookieSecure);
    } catch (error) {
      if (token !== undefined) clearSessionCookie(res, cookieSecure);
      throw error;
    }
    next();
  };

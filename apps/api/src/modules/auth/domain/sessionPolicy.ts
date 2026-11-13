import type { UserId } from '@todo/contracts';

/**
 * Session lifetimes. A session token is short-lived and slides: an active user gets a fresh one
 * once the current token is past half its life, so only an idle session expires. However active,
 * a session never outlives SESSION_ABSOLUTE_MAX_SECONDS from the sign-in that opened it.
 */
export const SESSION_TTL_SECONDS = 60 * 60;
/** A token at least this old is re-issued on the next authenticated request. */
export const SESSION_RENEW_AFTER_SECONDS = SESSION_TTL_SECONDS / 2;
/** No token is valid later than this after sign-in (`auth_time`); sign in again after it. */
export const SESSION_ABSOLUTE_MAX_SECONDS = 7 * 24 * 60 * 60;

const MS = 1000;

/** What a verified session token says. */
export type SessionClaims = {
  userId: UserId;
  /** The user's session version when the token was issued; a bump revokes the token. */
  sessionVersion: number;
  /** When the user signed in; carried unchanged by every renewal. */
  authTime: Date;
  issuedAt: Date;
  expiresAt: Date;
};

const absoluteEnd = (authTime: Date): Date =>
  new Date(authTime.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * MS);

/** The expiry of a token issued now: one TTL away, but never past the absolute cap. */
export const expiryFor = (authTime: Date, now: Date): Date =>
  new Date(Math.min(now.getTime() + SESSION_TTL_SECONDS * MS, absoluteEnd(authTime).getTime()));

/**
 * The expiry a renewed token would get, or undefined when this token is not due for renewal:
 * it is younger than half its life, or the absolute cap leaves nothing to extend.
 */
export const renewedExpiry = (claims: SessionClaims, now: Date): Date | undefined => {
  const age = now.getTime() - claims.issuedAt.getTime();
  if (age < SESSION_RENEW_AFTER_SECONDS * MS) return undefined;
  const expiresAt = expiryFor(claims.authTime, now);
  return expiresAt.getTime() > claims.expiresAt.getTime() ? expiresAt : undefined;
};

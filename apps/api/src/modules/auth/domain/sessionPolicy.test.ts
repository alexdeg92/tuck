import { describe, expect, it } from 'vitest';
import {
  expiryFor,
  renewedExpiry,
  SESSION_ABSOLUTE_MAX_SECONDS,
  SESSION_RENEW_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  type SessionClaims,
} from './sessionPolicy';

const SIGNED_IN = new Date('2026-11-11T09:00:00.000Z');
const at = (seconds: number) => new Date(SIGNED_IN.getTime() + seconds * 1000);

/** A token issued `issuedAfter` seconds after sign-in, with the expiry policy gives it. */
const tokenIssued = (issuedAfter: number): SessionClaims => ({
  userId: '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d',
  sessionVersion: 0,
  authTime: SIGNED_IN,
  issuedAt: at(issuedAfter),
  expiresAt: expiryFor(SIGNED_IN, at(issuedAfter)),
});

describe('session policy', () => {
  it('keeps tokens short, renews at half-life and caps a session at 7 days', () => {
    expect(SESSION_TTL_SECONDS).toBe(3600);
    expect(SESSION_RENEW_AFTER_SECONDS).toBe(1800);
    expect(SESSION_ABSOLUTE_MAX_SECONDS).toBe(7 * 24 * 3600);
  });

  it('gives a new token one TTL, clamped to the absolute cap', () => {
    expect(expiryFor(SIGNED_IN, SIGNED_IN)).toEqual(at(SESSION_TTL_SECONDS));
    const nearCap = SESSION_ABSOLUTE_MAX_SECONDS - 600;
    expect(expiryFor(SIGNED_IN, at(nearCap))).toEqual(at(SESSION_ABSOLUTE_MAX_SECONDS));
  });

  it('does not renew a token younger than half its life', () => {
    expect(renewedExpiry(tokenIssued(0), at(SESSION_RENEW_AFTER_SECONDS - 1))).toBeUndefined();
  });

  it('renews a token from half its life on, for one TTL from now', () => {
    const now = at(SESSION_RENEW_AFTER_SECONDS);
    expect(renewedExpiry(tokenIssued(0), now)).toEqual(at(SESSION_RENEW_AFTER_SECONDS + 3600));
  });

  it('measures half-life from the token, not from sign-in', () => {
    const renewed = tokenIssued(5 * 3600);
    expect(renewedExpiry(renewed, at(5 * 3600 + 60))).toBeUndefined();
    expect(renewedExpiry(renewed, at(5 * 3600 + SESSION_RENEW_AFTER_SECONDS))).toBeDefined();
  });

  it('renews only up to the absolute cap, then stops', () => {
    const lastFullTtl = SESSION_ABSOLUTE_MAX_SECONDS - 3 * 3600;
    const nearCap = renewedExpiry(tokenIssued(lastFullTtl), at(SESSION_ABSOLUTE_MAX_SECONDS - 600));
    expect(nearCap).toEqual(at(SESSION_ABSOLUTE_MAX_SECONDS));

    const capped = tokenIssued(SESSION_ABSOLUTE_MAX_SECONDS - 3600);
    expect(capped.expiresAt).toEqual(at(SESSION_ABSOLUTE_MAX_SECONDS));
    expect(renewedExpiry(capped, at(SESSION_ABSOLUTE_MAX_SECONDS - 60))).toBeUndefined();
  });
});

import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { makeJoseTokens } from './joseTokens';

const SECRET = 'x'.repeat(32);
const USER = '5b1c9d2e-4f6a-4c8b-a1d3-7e9f0a2b4c6d';
const START = new Date('2026-11-11T09:00:00.000Z');
const HOUR_LATER = new Date(START.getTime() + 3600_000);
const SIGNED_IN = new Date('2026-11-10T09:00:00.000Z');

const claims = {
  userId: USER,
  sessionVersion: 3,
  authTime: SIGNED_IN,
  expiresAt: HOUR_LATER,
};

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('jose tokens', () => {
  it('round-trips the subject, session version, sign-in time, issue time and expiry', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });

    expect(await tokens.verify(await tokens.issue(claims))).toEqual({
      userId: USER,
      sessionVersion: 3,
      authTime: SIGNED_IN,
      issuedAt: START,
      expiresAt: HOUR_LATER,
    });
  });

  it('writes the claims as sub, sv, auth_time, iat and exp', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });

    expect(decodeJwt(await tokens.issue(claims))).toEqual({
      sub: USER,
      sv: 3,
      auth_time: SIGNED_IN.getTime() / 1000,
      iat: START.getTime() / 1000,
      exp: HOUR_LATER.getTime() / 1000,
    });
  });

  it('accepts a token until its expiry', async () => {
    let now = START;
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => now });
    const token = await tokens.issue(claims);

    now = new Date(START.getTime() + 3599_000);
    expect((await tokens.verify(token))?.userId).toBe(USER);
    now = new Date(START.getTime() + 3601_000);
    expect(await tokens.verify(token)).toBeUndefined();
  });

  it('reads a token from before sv and auth_time as version 0, signed in when issued', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });
    const legacy = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuedAt(START.getTime() / 1000)
      .setExpirationTime(HOUR_LATER.getTime() / 1000)
      .sign(new TextEncoder().encode(SECRET));

    expect(await tokens.verify(legacy)).toMatchObject({ sessionVersion: 0, authTime: START });
  });

  it('rejects a signed token with a malformed session version', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });
    const odd = await new SignJWT({ sv: 'latest' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuedAt(START.getTime() / 1000)
      .setExpirationTime(HOUR_LATER.getTime() / 1000)
      .sign(new TextEncoder().encode(SECRET));

    expect(await tokens.verify(odd)).toBeUndefined();
  });

  it('rejects a tampered payload', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });
    const [header, , signature] = (await tokens.issue(claims)).split('.');
    const forged = base64url({
      sub: '8d4e2a6b-1c3f-4b7a-8e9d-0f1a2b3c4d5e',
      sv: 3,
      iat: 1,
      exp: 4102444800,
    });

    expect(await tokens.verify(`${String(header)}.${forged}.${String(signature)}`)).toBeUndefined();
  });

  it('rejects a token signed with another secret', async () => {
    const other = makeJoseTokens({ secret: 'y'.repeat(32), clock: () => START });
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });

    expect(await tokens.verify(await other.issue(claims))).toBeUndefined();
  });

  it('rejects an unsigned alg=none token', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: USER, iat: 1, exp: 4102444800 })}.`;

    expect(await tokens.verify(unsigned)).toBeUndefined();
  });

  it('rejects garbage', async () => {
    const tokens = makeJoseTokens({ secret: SECRET, clock: () => START });
    expect(await tokens.verify('not-a-jwt')).toBeUndefined();
  });
});

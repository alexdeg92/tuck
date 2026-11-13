import { describe, expect, it, vi } from 'vitest';
import { makeJoseTokens } from '../infrastructure/joseTokens';
import { makeMemoryUserRepository } from '../infrastructure/memoryUserRepository';
import { makeScryptHasher, SCRYPT_PARAMS } from '../infrastructure/scryptHasher';
import { makeAuthenticate, makeLogIn, makeLogOutEverywhere, makeSignUp } from './useCases';

const NOW = new Date('2026-11-11T09:30:00.000Z');
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const credentials = { email: 'demo@example.com', password: 'demo1234' };

const setup = () => {
  const users = makeMemoryUserRepository();
  const hasher = makeScryptHasher({ ...SCRYPT_PARAMS, N: 1024 });
  const time = { now: NOW };
  const clock = () => time.now;
  const tokens = makeJoseTokens({ secret: 'x'.repeat(32), clock });
  const deps = { users, hasher, tokens, clock, ids: () => crypto.randomUUID() };
  return {
    time,
    users,
    hasher,
    tokens,
    logOutEverywhere: makeLogOutEverywhere(deps),
    signUp: makeSignUp(deps),
    logIn: makeLogIn(deps),
    authenticate: makeAuthenticate(deps),
  };
};

describe('auth use cases', () => {
  it('signs up a user and opens a session', async () => {
    const { signUp, authenticate } = setup();

    const { user, token } = await signUp(credentials);

    expect(user.email).toBe('demo@example.com');
    expect(Object.keys(user)).toEqual(['id', 'email']);
    expect(await authenticate(token)).toEqual({ user });
  });

  it('refuses a second sign-up with the same email', async () => {
    const { signUp } = setup();
    await signUp(credentials);

    await expect(signUp(credentials)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('logs in with the right password', async () => {
    const { signUp, logIn } = setup();
    const { user } = await signUp(credentials);

    expect((await logIn(credentials)).user).toEqual(user);
  });

  it('gives the same generic error for a wrong password and an unknown email', async () => {
    const { signUp, logIn } = setup();
    await signUp(credentials);
    const generic = { code: 'UNAUTHENTICATED', message: 'Invalid email or password' };

    await expect(logIn({ ...credentials, password: 'wrong-password' })).rejects.toMatchObject(
      generic,
    );
    await expect(logIn({ ...credentials, email: 'nobody@example.com' })).rejects.toMatchObject(
      generic,
    );
  });

  it('still runs one full hash compare for an unknown email (timing guard)', async () => {
    const { logIn, hasher } = setup();
    const verify = vi.spyOn(hasher, 'verify');

    await expect(logIn({ ...credentials, email: 'nobody@example.com' })).rejects.toThrow();

    expect(verify).toHaveBeenCalledExactlyOnceWith(credentials.password, hasher.dummyHash);
  });

  it.each([
    ['no token', undefined],
    ['an invalid token', 'garbage'],
  ])('rejects %s as UNAUTHENTICATED', async (_label, token) => {
    const { authenticate } = setup();
    await expect(authenticate(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a valid token whose user no longer exists', async () => {
    const { authenticate, tokens } = setup();
    const orphan = await tokens.issue({
      userId: crypto.randomUUID(),
      sessionVersion: 0,
      authTime: NOW,
      expiresAt: minutesLater(60),
    });

    await expect(authenticate(orphan)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('opens a one-hour session that starts at version 0, signed in now', async () => {
    const { signUp, tokens } = setup();
    const { token, expiresAt } = await signUp(credentials);

    expect(expiresAt).toEqual(minutesLater(60));
    expect(await tokens.verify(token)).toMatchObject({
      sessionVersion: 0,
      authTime: NOW,
      expiresAt: minutesLater(60),
    });
  });

  it('rejects every token issued before a sign-out everywhere, and accepts a new sign-in', async () => {
    const { signUp, logIn, logOutEverywhere, authenticate, tokens } = setup();
    const { user, token: laptop } = await signUp(credentials);
    const { token: phone } = await logIn(credentials);

    await logOutEverywhere(user.id);

    await expect(authenticate(laptop)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(authenticate(phone)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const { token: fresh } = await logIn(credentials);
    expect((await tokens.verify(fresh))?.sessionVersion).toBe(1);
    expect(await authenticate(fresh)).toEqual({ user });
  });

  it('leaves other users signed in on a sign-out everywhere', async () => {
    const { signUp, logOutEverywhere, authenticate } = setup();
    const { user } = await signUp(credentials);
    const other = await signUp({ ...credentials, email: 'other@example.com' });

    await logOutEverywhere(user.id);

    expect(await authenticate(other.token)).toEqual({ user: other.user });
  });

  it('refuses a sign-out everywhere for an unknown user', async () => {
    const { logOutEverywhere } = setup();
    await expect(logOutEverywhere(crypto.randomUUID())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('renews a token past half its life with the same version and sign-in time', async () => {
    const { signUp, authenticate, tokens, time } = setup();
    const { user, token } = await signUp(credentials);

    time.now = minutesLater(29);
    expect(await authenticate(token)).toEqual({ user });

    time.now = minutesLater(30);
    const { renewed } = await authenticate(token);
    expect(renewed?.expiresAt).toEqual(minutesLater(90));
    expect(await tokens.verify(renewed?.token ?? '')).toMatchObject({
      userId: user.id,
      sessionVersion: 0,
      authTime: NOW,
      issuedAt: minutesLater(30),
      expiresAt: minutesLater(90),
    });
  });
});

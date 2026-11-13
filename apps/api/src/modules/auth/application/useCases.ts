import type { Credentials, User, UserId } from '@todo/contracts';
import { conflict, unauthenticated } from '../../../shared/errors';
import { expiryFor, renewedExpiry } from '../domain/sessionPolicy';
import { toUser, type UserAccount } from '../domain/user';
import type { PasswordHasher, TokenIssuer, UserRepository } from './ports';

type Deps = {
  users: UserRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  clock: () => Date;
  ids: () => string;
};

/** A signed session token and when it expires (the cookie lives exactly as long). */
export type SessionToken = { token: string; expiresAt: Date };
export type Session = SessionToken & { user: User };

const openSession =
  ({ tokens, clock }: Pick<Deps, 'tokens' | 'clock'>) =>
  async (account: UserAccount): Promise<Session> => {
    const now = clock();
    const expiresAt = expiryFor(now, now);
    const token = await tokens.issue({
      userId: account.id,
      sessionVersion: account.sessionVersion,
      authTime: now,
      expiresAt,
    });
    return { user: toUser(account), token, expiresAt };
  };

export const makeSignUp =
  ({ users, hasher, tokens, clock, ids }: Deps) =>
  async ({ email, password }: Credentials): Promise<Session> => {
    if (await users.findByEmail(email)) throw conflict('Email already registered');
    const account = {
      id: ids(),
      email,
      passwordHash: await hasher.hash(password),
      createdAt: clock().toISOString(),
      sessionVersion: 0,
    };
    await users.insert(account);
    return openSession({ tokens, clock })(account);
  };

export const makeLogIn =
  ({ users, hasher, tokens, clock }: Pick<Deps, 'users' | 'hasher' | 'tokens' | 'clock'>) =>
  async ({ email, password }: Credentials): Promise<Session> => {
    const account = await users.findByEmail(email);
    const valid = await hasher.verify(password, account?.passwordHash ?? hasher.dummyHash);
    if (!account || !valid) throw unauthenticated('Invalid email or password');
    return openSession({ tokens, clock })(account);
  };

export type Authenticated = { user: User; renewed?: SessionToken };

/**
 * 401 for a missing, invalid or expired token, a deleted user, or a token whose session version
 * is behind the account's (signed out everywhere). The user is loaded on every request anyway,
 * so revocation costs no extra query. A token past half its life is renewed (sliding session).
 */
export const makeAuthenticate =
  ({ users, tokens, clock }: Pick<Deps, 'users' | 'tokens' | 'clock'>) =>
  async (token: string | undefined): Promise<Authenticated> => {
    const claims = token === undefined ? undefined : await tokens.verify(token);
    const account = claims === undefined ? undefined : await users.findById(claims.userId);
    if (!claims || !account || account.sessionVersion !== claims.sessionVersion) {
      throw unauthenticated();
    }
    const user = toUser(account);
    const expiresAt = renewedExpiry(claims, clock());
    if (expiresAt === undefined) return { user };
    const renewed = await tokens.issue({
      userId: account.id,
      sessionVersion: account.sessionVersion,
      authTime: claims.authTime,
      expiresAt,
    });
    return { user, renewed: { token: renewed, expiresAt } };
  };

/** Revokes every session of the user, on every device: their tokens now carry an old version. */
export const makeLogOutEverywhere =
  ({ users }: Pick<Deps, 'users'>) =>
  async (userId: UserId): Promise<void> => {
    if ((await users.bumpSessionVersion(userId)) === undefined) throw unauthenticated();
  };

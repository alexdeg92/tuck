import type { UserId } from '@todo/contracts';
import type { SessionClaims } from '../domain/sessionPolicy';
import type { UserAccount } from '../domain/user';

export type UserRepository = {
  insert: (account: UserAccount) => Promise<void>;
  findByEmail: (email: string) => Promise<UserAccount | undefined>;
  findById: (id: UserId) => Promise<UserAccount | undefined>;
  /**
   * Atomically adds one to the user's session version, revoking every token issued before.
   * Resolves to the new version, or undefined for an unknown user.
   */
  bumpSessionVersion: (id: UserId) => Promise<number | undefined>;
};

export type PasswordHasher = {
  hash: (password: string) => Promise<string>;
  verify: (password: string, stored: string) => Promise<boolean>;

  dummyHash: string;
};

export type TokenToIssue = {
  userId: UserId;
  sessionVersion: number;
  authTime: Date;
  expiresAt: Date;
};

export type TokenIssuer = {
  issue: (token: TokenToIssue) => Promise<string>;

  verify: (token: string) => Promise<SessionClaims | undefined>;
};

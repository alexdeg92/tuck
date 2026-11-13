import { conflict } from '../../../shared/errors';
import type { UserRepository } from '../application/ports';
import type { UserAccount } from '../domain/user';

export const makeMemoryUserRepository = (): UserRepository => {
  const accounts = new Map<string, UserAccount>();
  // Copies in and out, like a database: a caller can't change a stored account in place.
  const copyOf = (account: UserAccount | undefined) => account && { ...account };
  const byEmail = (email: string) =>
    [...accounts.values()].find((account) => account.email === email);

  return {
    insert: async (account) => {
      if (byEmail(account.email)) throw conflict('Email already registered');
      accounts.set(account.id, { ...account });
    },
    findByEmail: async (email) => copyOf(byEmail(email)),
    findById: async (id) => copyOf(accounts.get(id)),
    bumpSessionVersion: async (id) => {
      const account = accounts.get(id);
      if (!account) return undefined;
      account.sessionVersion += 1;
      return account.sessionVersion;
    },
  };
};

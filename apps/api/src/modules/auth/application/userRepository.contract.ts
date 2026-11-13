import { describe, expect, it } from 'vitest';
import type { UserAccount } from '../domain/user';
import type { UserRepository } from './ports';

/** The behaviour every UserRepository must have; run by the memory, SQLite and Postgres adapters. */
export const describeUserRepository = (
  name: string,
  setup: () => Promise<UserRepository>,
): void => {
  describe(`${name} user repository (contract)`, () => {
    const account = (email = 'demo@example.com'): UserAccount => ({
      id: crypto.randomUUID(),
      email,
      passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      createdAt: '2026-11-11T09:30:00.000Z',
      sessionVersion: 0,
    });

    it('finds an inserted account by email and by id', async () => {
      const users = await setup();
      const demo = account();
      await users.insert(demo);

      expect(await users.findByEmail('demo@example.com')).toEqual(demo);
      expect(await users.findById(demo.id)).toEqual(demo);
    });

    it('returns undefined for unknown accounts', async () => {
      const users = await setup();
      expect(await users.findByEmail('nobody@example.com')).toBeUndefined();
      expect(await users.findById(crypto.randomUUID())).toBeUndefined();
    });

    it('rejects a second account with the same email as CONFLICT', async () => {
      const users = await setup();
      await users.insert(account());

      await expect(users.insert(account())).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it("bumps one user's session version by one each time and leaves other users alone", async () => {
      const users = await setup();
      const demo = account();
      const other = account('other@example.com');
      await users.insert(demo);
      await users.insert(other);

      expect(await users.bumpSessionVersion(demo.id)).toBe(1);
      expect(await users.bumpSessionVersion(demo.id)).toBe(2);
      expect(await users.findById(demo.id)).toEqual({ ...demo, sessionVersion: 2 });
      expect((await users.findByEmail('demo@example.com'))?.sessionVersion).toBe(2);
      expect((await users.findById(other.id))?.sessionVersion).toBe(0);
    });

    it('counts concurrent bumps once each', async () => {
      const users = await setup();
      const demo = account();
      await users.insert(demo);

      await Promise.all([1, 2, 3, 4, 5].map(() => users.bumpSessionVersion(demo.id)));

      expect((await users.findById(demo.id))?.sessionVersion).toBe(5);
    });

    it('bumps nothing for an unknown user', async () => {
      const users = await setup();
      expect(await users.bumpSessionVersion(crypto.randomUUID())).toBeUndefined();
    });
  });
};

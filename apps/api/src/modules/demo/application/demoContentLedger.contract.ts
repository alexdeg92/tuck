import { describe, expect, it } from 'vitest';
import type { DemoContentLedger } from './ports';

const AT = '2026-11-11T09:30:00.000Z';

export type LedgerHarness = { ledger: DemoContentLedger; createUser: () => Promise<string> };

/** The behaviour every DemoContentLedger must have; run by the memory, SQLite and Postgres adapters. */
export const describeDemoContentLedger = (
  name: string,
  setup: () => Promise<LedgerHarness>,
): void => {
  describe(`${name} demo content ledger (contract)`, () => {
    const withUsers = async () => {
      const { ledger, createUser } = await setup();
      return { ledger, demo: await createUser(), other: await createUser() };
    };

    it('has no keys for a user it has never seen', async () => {
      const { ledger, demo } = await withUsers();
      expect(await ledger.keys(demo)).toEqual(new Set());
    });

    it('claims a key once: the second claim of the same key is refused', async () => {
      const { ledger, demo } = await withUsers();

      expect(await ledger.claim(demo, 'groceries', AT)).toBe(true);
      expect(await ledger.claim(demo, 'groceries', AT)).toBe(false);
      expect(await ledger.claim(demo, 'passport', AT)).toBe(true);
      expect(await ledger.keys(demo)).toEqual(new Set(['groceries', 'passport']));
    });

    it("keeps each user's keys apart", async () => {
      const { ledger, demo, other } = await withUsers();
      await ledger.claim(demo, 'groceries', AT);

      expect(await ledger.keys(other)).toEqual(new Set());
      expect(await ledger.claim(other, 'groceries', AT)).toBe(true);
    });
  });
};

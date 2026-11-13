import type { UserId } from '@todo/contracts';

export type DemoContentLedger = {
  keys: (userId: UserId) => Promise<Set<string>>;

  claim: (userId: UserId, key: string, at: string) => Promise<boolean>;
};

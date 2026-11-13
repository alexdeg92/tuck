import type { DemoContentLedger } from '../application/ports';

export const makeMemoryDemoContentLedger = (): DemoContentLedger => {
  const claimed = new Map<string, Set<string>>();
  return {
    keys: async (userId) => new Set(claimed.get(userId)),
    claim: async (userId, key) => {
      const keys = claimed.get(userId) ?? new Set<string>();
      if (keys.has(key)) return false;
      claimed.set(userId, keys.add(key));
      return true;
    },
  };
};

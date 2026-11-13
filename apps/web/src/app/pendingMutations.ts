import type { QueryClient } from '@tanstack/react-query';

export function waitForPendingMutations(client: QueryClient, timeoutMs = 30_000): Promise<void> {
  if (client.isMutating() === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const unsubscribe = client.getMutationCache().subscribe(() => {
      if (client.isMutating() !== 0) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Some changes are still saving'));
    }, timeoutMs);
  });
}

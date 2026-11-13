import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { waitForPendingMutations } from './pendingMutations';

describe('release mutation bridge', () => {
  it('resolves immediately when idle', async () => {
    await expect(waitForPendingMutations(new QueryClient())).resolves.toBeUndefined();
  });
  it.each(['priority', 'create', 'reorder', 'status', 'delete', 'checklist'])(
    'waits for a pending %s mutation',
    async (key) => {
      const client = new QueryClient();
      let release = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const mutation = client
        .getMutationCache()
        .build(client, { mutationKey: [key], mutationFn: () => pending });
      const request = mutation.execute(undefined);
      const done = vi.fn();
      const flush = waitForPendingMutations(client).then(done);
      await Promise.resolve();
      expect(done).not.toHaveBeenCalled();
      release();
      await request;
      await flush;
      expect(done).toHaveBeenCalledOnce();
      client.clear();
    },
  );
  it('bounds waiting and permits a later retry after settling', async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    let release = () => {};
    const request = client
      .getMutationCache()
      .build(client, {
        mutationFn: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      })
      .execute(undefined);
    await Promise.resolve();
    const flush = waitForPendingMutations(client, 100);
    const rejected = expect(flush).rejects.toThrow('still saving');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    release();
    await request;
    await expect(waitForPendingMutations(client)).resolves.toBeUndefined();
    client.clear();
    vi.useRealTimers();
  });
});

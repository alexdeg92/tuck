import { describe, expect, it } from 'vitest';
import { openStorage } from './storage';

describe('openStorage without DATABASE_URL', () => {
  it('opens migrated SQLite repositories', async () => {
    const storage = await openStorage({ databaseUrl: undefined, databaseFile: ':memory:' });
    const id = crypto.randomUUID();
    await storage.users.insert({
      id,
      email: 'demo@example.com',
      passwordHash: 'scrypt$x',
      createdAt: '2026-11-11T09:30:00.000Z',
      sessionVersion: 0,
    });

    expect(storage.engine).toBe('sqlite');
    expect(await storage.users.findById(id)).toMatchObject({ email: 'demo@example.com' });
    expect(await storage.tasks.list(id)).toEqual([]);
    await storage.close();
  });
});

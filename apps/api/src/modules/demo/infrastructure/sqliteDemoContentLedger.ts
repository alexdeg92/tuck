import type { Db } from '../../../shared/db/connection';
import type { DemoContentLedger } from '../application/ports';

export const makeSqliteDemoContentLedger = (db: Db): DemoContentLedger => {
  const keys = db
    .prepare<{ userId: string }, string>('SELECT key FROM demo_content WHERE user_id = @userId')
    .pluck();
  const claim = db.prepare<{ userId: string; key: string; at: string }>(
    `INSERT INTO demo_content (user_id, key, seeded_at) VALUES (@userId, @key, @at)
     ON CONFLICT (user_id, key) DO NOTHING`,
  );
  return {
    keys: async (userId) => new Set(keys.all({ userId })),
    claim: async (userId, key, at) => claim.run({ userId, key, at }).changes > 0,
  };
};

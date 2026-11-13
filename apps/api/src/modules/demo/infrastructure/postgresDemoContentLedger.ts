import type pg from 'pg';
import type { DemoContentLedger } from '../application/ports';

export const makePostgresDemoContentLedger = (pool: pg.Pool): DemoContentLedger => ({
  keys: async (userId) =>
    new Set(
      (
        await pool.query<{ key: string }>('SELECT key FROM demo_content WHERE user_id = $1', [
          userId,
        ])
      ).rows.map(({ key }) => key),
    ),
  claim: async (userId, key, at) =>
    ((
      await pool.query(
        `INSERT INTO demo_content (user_id, key, seeded_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING`,
        [userId, key, at],
      )
    ).rowCount ?? 0) > 0,
});

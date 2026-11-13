import { runPostgresMigrations } from '../../../shared/db/migratePostgres';
import { openTestPool } from '../../../testingPostgres';
import { describeDemoContentLedger } from '../application/demoContentLedger.contract';
import { makePostgresDemoContentLedger } from './postgresDemoContentLedger';

describeDemoContentLedger('postgres', async () => {
  const pool = await openTestPool();
  await runPostgresMigrations(pool);
  const createUser = async () => {
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, 'x', now())",
      [id, `${id}@example.com`],
    );
    return id;
  };
  return { ledger: makePostgresDemoContentLedger(pool), createUser };
});

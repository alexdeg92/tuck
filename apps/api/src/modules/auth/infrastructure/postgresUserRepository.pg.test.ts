import { runPostgresMigrations } from '../../../shared/db/migratePostgres';
import { openTestPool } from '../../../testingPostgres';
import { describeUserRepository } from '../application/userRepository.contract';
import { makePostgresUserRepository } from './postgresUserRepository';

describeUserRepository('postgres', async () => {
  const pool = await openTestPool();
  await runPostgresMigrations(pool);
  return makePostgresUserRepository(pool);
});

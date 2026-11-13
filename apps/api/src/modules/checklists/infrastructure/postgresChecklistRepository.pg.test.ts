import { runPostgresMigrations } from '../../../shared/db/migratePostgres';
import { openTestPool } from '../../../testingPostgres';
import {
  type ChecklistHarness,
  describeChecklistRepository,
} from '../application/checklistRepository.contract';
import { makePostgresTaskRepository } from '../../tasks/infrastructure/postgresTaskRepository';
import { makePostgresChecklistRepository } from './postgresChecklistRepository';

const harness = async (): Promise<ChecklistHarness> => {
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
  return {
    tasks: makePostgresTaskRepository(pool),
    checklists: makePostgresChecklistRepository(pool),
    createUser,
  };
};

describeChecklistRepository('postgres', harness);

import type { UserRepository } from './modules/auth/application';
import { makePostgresUserRepository } from './modules/auth/infrastructure/postgresUserRepository';
import { makeSqliteUserRepository } from './modules/auth/infrastructure/sqliteUserRepository';
import type { ChecklistRepository } from './modules/checklists/application';
import { makePostgresChecklistRepository } from './modules/checklists/infrastructure/postgresChecklistRepository';
import { makeSqliteChecklistRepository } from './modules/checklists/infrastructure/sqliteChecklistRepository';
import type { DemoContentLedger } from './modules/demo/application';
import { makePostgresDemoContentLedger } from './modules/demo/infrastructure/postgresDemoContentLedger';
import { makeSqliteDemoContentLedger } from './modules/demo/infrastructure/sqliteDemoContentLedger';
import type { TaskRepository } from './modules/tasks/application';
import { makePostgresTaskRepository } from './modules/tasks/infrastructure/postgresTaskRepository';
import { makeSqliteTaskRepository } from './modules/tasks/infrastructure/sqliteTaskRepository';
import type { Config } from './shared/config';
import { openDatabase } from './shared/db/connection';
import { runMigrations } from './shared/db/migrate';
import { runPostgresMigrations } from './shared/db/migratePostgres';
import { openPool } from './shared/db/postgres';

export type Storage = {
  engine: 'sqlite' | 'postgres';
  users: UserRepository;
  tasks: TaskRepository;
  checklists: ChecklistRepository;
  demo: DemoContentLedger;
  close: () => Promise<void>;
};

/**
 * Picks the persistence engine from the config: Postgres when DATABASE_URL is set, otherwise
 * the SQLite file. Both are migrated before use, and both pass the same repository suites.
 */
export const openStorage = async ({
  databaseUrl,
  databaseFile,
}: Pick<Config, 'databaseUrl' | 'databaseFile'>): Promise<Storage> => {
  if (databaseUrl !== undefined) {
    const pool = openPool(databaseUrl);

    await runPostgresMigrations(pool).catch(async (error: unknown) => {
      await pool.end();
      throw error;
    });
    return {
      engine: 'postgres',
      users: makePostgresUserRepository(pool),
      tasks: makePostgresTaskRepository(pool),
      checklists: makePostgresChecklistRepository(pool),
      demo: makePostgresDemoContentLedger(pool),
      close: () => pool.end(),
    };
  }
  const db = openDatabase(databaseFile);
  runMigrations(db);
  return {
    engine: 'sqlite',
    users: makeSqliteUserRepository(db),
    tasks: makeSqliteTaskRepository(db),
    checklists: makeSqliteChecklistRepository(db),
    demo: makeSqliteDemoContentLedger(db),
    close: async () => {
      db.close();
    },
  };
};

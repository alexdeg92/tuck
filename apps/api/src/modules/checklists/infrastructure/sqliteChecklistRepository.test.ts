import { afterEach } from 'vitest';
import { type Db, openDatabase } from '../../../shared/db/connection';
import { runMigrations } from '../../../shared/db/migrate';
import {
  type ChecklistHarness,
  describeChecklistRepository,
} from '../application/checklistRepository.contract';
import { makeSqliteTaskRepository } from '../../tasks/infrastructure/sqliteTaskRepository';
import { makeSqliteChecklistRepository } from './sqliteChecklistRepository';

const open: Db[] = [];
afterEach(() => {
  open.splice(0).forEach((db) => db.close());
});

const harness = async (): Promise<ChecklistHarness> => {
  const db = openDatabase(':memory:');
  open.push(db);
  runMigrations(db);
  const insertUser = db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', '2026-11-11T00:00:00.000Z')",
  );
  const createUser = async () => {
    const id = crypto.randomUUID();
    insertUser.run(id, `${id}@example.com`);
    return id;
  };
  return {
    tasks: makeSqliteTaskRepository(db),
    checklists: makeSqliteChecklistRepository(db),
    createUser,
  };
};

describeChecklistRepository('sqlite', harness);

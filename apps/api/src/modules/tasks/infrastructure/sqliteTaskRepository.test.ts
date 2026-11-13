import { afterEach } from 'vitest';
import { type Db, openDatabase } from '../../../shared/db/connection';
import { runMigrations } from '../../../shared/db/migrate';
import { describeTrashRepository } from '../application/trashRepository.contract';
import {
  describeTaskRepository,
  type RepositoryHarness,
} from '../application/taskRepository.contract';
import { makeSqliteTaskRepository } from './sqliteTaskRepository';

const open: Db[] = [];
afterEach(() => {
  open.splice(0).forEach((db) => db.close());
});

const harness = async (): Promise<RepositoryHarness> => {
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
  return { tasks: makeSqliteTaskRepository(db), createUser };
};

describeTaskRepository('sqlite', harness);
describeTrashRepository('sqlite', harness);

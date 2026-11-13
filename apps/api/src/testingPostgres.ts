import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterEach } from 'vitest';
import { openPool } from './shared/db/postgres';

const cleanups: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const serverUrl = (): string => {
  const url = process.env['TEST_DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set: run the Postgres suites with `npm run test:pg`.',
    );
  }
  return url;
};

const asAdmin = async (sql: string): Promise<void> => {
  const client = new pg.Client({ connectionString: serverUrl() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
};

export const freshSchemaUrl = async (): Promise<string> => {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await asAdmin(`CREATE SCHEMA ${schema}`);
  cleanups.push(() => asAdmin(`DROP SCHEMA ${schema} CASCADE`));
  const url = new URL(serverUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
};

export const openTestPool = async (): Promise<pg.Pool> => {
  const pool = openPool(await freshSchemaUrl());
  cleanups.push(() => pool.end());
  return pool;
};

import pg from 'pg';

const typeOverrides = (): pg.TypeOverrides => {
  const types = new pg.TypeOverrides();
  types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
  return types;
};

export const openPool = (connectionString: string): pg.Pool =>
  new pg.Pool({ connectionString, types: typeOverrides() });

export const inTransaction = async <T>(
  client: pg.PoolClient,
  work: () => Promise<T>,
): Promise<T> => {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

export const withTransaction = async <T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    return await inTransaction(client, () => work(client));
  } finally {
    client.release();
  }
};

export const lockForTransaction = async (client: pg.PoolClient, key: string): Promise<void> => {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
};

export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === constraint;

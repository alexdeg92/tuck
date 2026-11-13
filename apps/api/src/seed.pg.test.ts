import { describeSeed } from './seed.contract';
import { openStorage } from './storage';
import { freshSchemaUrl } from './testingPostgres';

describeSeed('postgres', async () =>
  openStorage({ databaseUrl: await freshSchemaUrl(), databaseFile: 'unused.db' }),
);

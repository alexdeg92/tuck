import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'src/**/*.pg.test.ts', 'src/**/*.redis.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],

      exclude: [
        'src/**/*.test.ts',
        'src/**/*.contract.ts',
        'src/testing.ts',
        'src/testingPostgres.ts',
        'src/server.ts',

        'src/**/postgres*.ts',
        'src/shared/db/migratePostgres.ts',
        'src/shared/http/redisRateLimitStore.ts',
      ],
      thresholds: { lines: 85 },
    },
  },
});

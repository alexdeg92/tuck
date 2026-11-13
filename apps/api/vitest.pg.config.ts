import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.pg.test.ts', 'src/**/*.redis.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/**/postgres*.ts',
        'src/shared/db/migratePostgres.ts',
        'src/shared/http/redisRateLimitStore.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/testingPostgres.ts'],
      thresholds: { lines: 85 },
    },
  },
});

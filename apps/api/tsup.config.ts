import { cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  clean: true,

  noExternal: ['@todo/contracts'],

  onSuccess: () => cp('src/shared/db/migrations', 'dist/migrations', { recursive: true }),
});

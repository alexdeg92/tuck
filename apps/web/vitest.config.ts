import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: { 'import.meta.env.VITE_DEMO_SIGN_IN': 'true' },
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: path.resolve(rootDir, '../../node_modules/react'),
      'react-dom': path.resolve(rootDir, '../../node_modules/react-dom'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/app/App.tsx',

        'src/features/tasks/components/TaskList.tsx',
        'src/**/*.module.css',
        'src/test/**',
      ],
      thresholds: { lines: 90 },
    },
  },
});

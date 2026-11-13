import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = mkdtempSync(join(tmpdir(), 'todo-e2e-'));
const serverEntry = fileURLToPath(new URL('../../apps/api/dist/server.js', import.meta.url));

const api = spawn(process.execPath, [serverEntry], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: process.env.E2E_API_PORT ?? '4310',
    DATABASE_FILE: join(dataDir, 'e2e.db'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    SEED_DEMO: 'true',
    COOKIE_SECURE: 'false',
  },
});

const cleanUp = () => rmSync(dataDir, { recursive: true, force: true });
const stop = (signal) => () => api.kill(signal);

process.on('SIGINT', stop('SIGINT'));
process.on('SIGTERM', stop('SIGTERM'));
api.on('exit', (code) => {
  cleanUp();
  process.exit(code ?? 0);
});

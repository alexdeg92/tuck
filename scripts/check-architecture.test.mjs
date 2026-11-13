/**
 * Proves the dependency-cruiser rules bite: each case writes a tiny fixture repo in a temp dir,
 * runs the real config against it and expects the named rule to fail (or everything to pass).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const depcruiseBin = join(repoRoot, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');
const config = join(repoRoot, '.dependency-cruiser.cjs');

/** One module per layer, each exporting a constant, plus fake packages to resolve. */
const BASE_FILES = {
  'packages/contracts/package.json': JSON.stringify({
    name: '@todo/contracts',
    type: 'module',
    exports: { '.': './src/index.ts' },
  }),
  'packages/contracts/src/index.ts': 'export const contract = 1;',
  'node_modules/express/package.json': JSON.stringify({ name: 'express', main: 'index.js' }),
  'node_modules/express/index.js': 'module.exports = {};',
  // npm may install a dependency inside the workspace instead of hoisting it to the root.
  'apps/api/node_modules/better-sqlite3/package.json': JSON.stringify({
    name: 'better-sqlite3',
    main: 'index.js',
  }),
  'apps/api/node_modules/better-sqlite3/index.js': 'module.exports = {};',
  'apps/api/node_modules/pg/package.json': JSON.stringify({ name: 'pg', main: 'index.js' }),
  'apps/api/node_modules/pg/index.js': 'module.exports = {};',
  'apps/api/node_modules/fractional-indexing/package.json': JSON.stringify({
    name: 'fractional-indexing',
    main: 'index.js',
  }),
  'apps/api/node_modules/fractional-indexing/index.js': 'module.exports = {};',
  'apps/api/src/app.ts': 'export const app = 1;',
  'apps/api/src/server.ts': 'export const server = 1;',
  'apps/api/src/shared/db/connection.ts': 'export const db = 1;',
  'apps/api/src/modules/tasks/domain/ordering.ts': 'export const ordering = 1;',
  'apps/api/src/modules/tasks/application/index.ts': 'export const tasks = 1;',
  'apps/api/src/modules/tasks/infrastructure/repository.ts': 'export const repository = 1;',
  'apps/api/src/modules/auth/application/index.ts': 'export const auth = 1;',
  'apps/api/src/modules/auth/application/logIn.ts': 'export const logIn = 1;',
  'apps/web/src/shared/api/http.ts': 'export const http = 1;',
};

const tempDirs = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const cruise = (probeFiles) => {
  const root = mkdtempSync(join(tmpdir(), 'arch-probe-'));
  tempDirs.push(root);
  Object.entries({ ...BASE_FILES, ...probeFiles }).forEach(([file, content]) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  });
  mkdirSync(join(root, 'node_modules/@todo'), { recursive: true });
  symlinkSync('../../packages/contracts', join(root, 'node_modules/@todo/contracts'), 'dir');
  const result = spawnSync(
    process.execPath,
    [depcruiseBin, 'apps', 'packages', '--config', config],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('architecture rules', () => {
  it('accept the allowed directions', () => {
    const { status, output } = cruise({
      'apps/api/src/modules/tasks/domain/search.ts':
        "import { ordering } from './ordering'; import { contract } from '@todo/contracts'; import keys from 'fractional-indexing'; export const search = [ordering, contract, keys];",
      'apps/api/src/modules/tasks/application/createTask.ts':
        "import { auth } from '../../auth/application/index'; import { ordering } from '../domain/ordering'; export const createTask = [auth, ordering];",
      'apps/api/src/modules/tasks/http/router.ts':
        "import { tasks } from '../application/index'; export const router = tasks;",
      'apps/api/src/modules/tasks/infrastructure/sqlite.ts':
        "import Database from 'better-sqlite3'; import { tasks } from '../application/index'; import { db } from '../../../shared/db/connection'; export const sqlite = [Database, tasks, db];",
      'apps/api/src/modules/tasks/infrastructure/postgres.ts':
        "import pg from 'pg'; export const postgres = pg;",
    });

    expect(output).toContain('no dependency violations found');
    expect(status).toBe(0);
  });

  it.each([
    [
      'application -> shared/db',
      'apps/api/src/modules/tasks/application/probe.ts',
      "import { db } from '../../../shared/db/connection'; export const probe = db;",
      'api-application-no-outer-layers',
    ],
    [
      'application -> app.ts',
      'apps/api/src/modules/tasks/application/probe.ts',
      "import { app } from '../../../app'; export const probe = app;",
      'api-application-no-outer-layers',
    ],
    [
      'infrastructure -> server.ts',
      'apps/api/src/modules/tasks/infrastructure/probe.ts',
      "import { server } from '../../../server'; export const probe = server;",
      'api-modules-not-to-composition-roots',
    ],
    [
      'http -> app.ts',
      'apps/api/src/modules/tasks/http/probe.ts',
      "import { app } from '../../../app'; export const probe = app;",
      'api-modules-not-to-composition-roots',
    ],
    [
      'http -> infrastructure',
      'apps/api/src/modules/tasks/http/probe.ts',
      "import { repository } from '../infrastructure/repository'; export const probe = repository;",
      'api-http-not-to-infrastructure',
    ],
    [
      'application -> workspace-local better-sqlite3',
      'apps/api/src/modules/tasks/application/probe.ts',
      "import Database from 'better-sqlite3'; export const probe = Database;",
      'api-application-no-outer-layers',
    ],
    [
      'application -> pg',
      'apps/api/src/modules/tasks/application/probe.ts',
      "export { Pool } from 'pg';",
      'api-application-no-outer-layers',
    ],
    [
      'domain -> pg',
      'apps/api/src/modules/tasks/domain/probe.ts',
      "import pg from 'pg'; export const probe = pg;",
      'api-domain-is-pure',
    ],
    [
      'domain -> workspace-local better-sqlite3',
      'apps/api/src/modules/tasks/domain/probe.ts',
      "import Database from 'better-sqlite3'; export const probe = Database;",
      'api-domain-is-pure',
    ],
    [
      'domain -> express',
      'apps/api/src/modules/tasks/domain/probe.ts',
      "import express from 'express'; export const probe = express;",
      'api-domain-is-pure',
    ],
    [
      "another module's private application file",
      'apps/api/src/modules/tasks/application/probe.ts',
      "import { logIn } from '../../auth/application/logIn'; export const probe = logIn;",
      'api-modules-talk-through-application-index',
    ],
    [
      'web component -> shared/api',
      'apps/web/src/features/tasks/components/TaskRow.ts',
      "import { http } from '../../../shared/api/http'; export const TaskRow = http;",
      'web-components-never-fetch',
    ],
  ])('reject %s', (_label, file, content, rule) => {
    const { status, output } = cruise({ [file]: content });

    expect(output).toContain(`error ${rule}:`);
    expect(status).not.toBe(0);
  });
});

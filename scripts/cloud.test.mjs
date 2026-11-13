import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function run(dotenv, action = 'up', extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-test-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  for (const name of ['cloud.sh', 'cloud-env.awk'])
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts', name));
  if (dotenv !== undefined) writeFileSync(join(root, '.env'), dotenv);
  writeFileSync(
    join(root, '.env.secret'),
    'JWT_SECRET=production-placeholder\nPOSTGRES_PASSWORD=production-placeholder\n',
  );
  writeFileSync(
    join(root, '.env.cloud-local.secret'),
    'JWT_SECRET=local-placeholder\nPOSTGRES_PASSWORD=local-placeholder\n',
  );
  writeFileSync(join(root, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> calls\n', { mode: 0o755 });
  const env = {
    PATH: `${root}:${process.env.PATH}`,
    COMPOSE_PROJECT_NAME: 'dangerous-production',
    ...extra,
  };
  const result = spawnSync('sh', ['scripts/cloud.sh', action], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  return {
    ...result,
    root,
    calls: existsSync(join(root, 'calls')) ? readFileSync(join(root, 'calls'), 'utf8') : '',
  };
}
it.each(['up', 'down', 'logs'])(
  'uses isolated source-built local cloud for %s without .env',
  (action) => {
    const result = run(undefined, action);
    expect(result.status).toBe(0);
    expect(result.calls).toContain(
      '--project-name tuck-cloud-local --env-file .env.cloud-local.secret -f compose.cloud.local.yml',
    );
    expect(result.calls).not.toContain('pull');
    if (action === 'up') expect(result.calls).toContain('up --build --detach --wait');
  },
);
it.each([
  'DOMAIN=example.com',
  'ACME_EMAIL=a@example.com',
  'DOMAIN=\nACME_EMAIL=',
  'DOMAIN=${HOST}\nACME_EMAIL=a@example.com',
  'DOMAIN="unterminated',
])('fails closed for incomplete or ambiguous production: %s', (dotenv) => {
  const result = run(dotenv);
  expect(result.status).not.toBe(0);
  expect(result.calls).toBe('');
});
it('accepts literal quotes, export, comments and CRLF without executing dotenv', () => {
  const result = run(
    'export DOMAIN = "example.com" # host\r\nACME_EMAIL=\'a@example.com\'\r\nOTHER=$(touch injected)\n',
  );
  expect(result.status).toBe(0);
  expect(result.calls).toContain('--project-name tuck-cloud ');
  expect(result.calls).toContain('pull --quiet api web');
  expect(existsSync(join(result.root, 'injected'))).toBe(false);
});
it('selects production from explicit environment and honors BUILD', () => {
  const result = run(undefined, 'up', {
    DOMAIN: 'example.com',
    ACME_EMAIL: 'a@example.com',
    BUILD: '1',
  });
  expect(result.status).toBe(0);
  expect(result.calls).toContain('-f compose.cloud.source.yml up --build');
  expect(result.calls).not.toContain('pull');
});
it('keeps unrelated development dotenv local', () => {
  expect(run('PORT=3000\n').calls).toContain('--project-name tuck-cloud-local');
});
it('preserves the local topology and production security configuration', () => {
  const local = readFileSync(new URL('../compose.cloud.local.yml', import.meta.url), 'utf8');
  const production = readFileSync(new URL('../compose.cloud.yml', import.meta.url), 'utf8');
  expect(local).toContain('127.0.0.1:${CLOUD_LOCAL_PORT:-8081}:80');
  expect(local).toContain('replicas: 2');
  expect(local).not.toMatch(/ghcr|websecure|letsencrypt|hsts/);
  expect(local).toContain("COOKIE_SECURE: 'false'");
  expect(production).toContain("COOKIE_SECURE: 'true'");
  expect(production).toContain('${SEED_DEMO:-false}');
  for (const [config, project] of [
    [local, 'tuck-cloud-local'],
    [production, 'tuck-cloud'],
  ]) {
    expect(config).toContain('Label(`com.docker.compose.project`, `' + project + '`)');
  }
});

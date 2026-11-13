/** The bundle budget: the built web app's JavaScript and CSS, gzipped, must stay under a cap. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('check-bundle-size.mjs', import.meta.url));
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const distWith = (files) => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  dirs.push(dist);
  mkdirSync(join(dist, 'assets'));
  Object.entries(files).forEach(([name, kb]) =>
    writeFileSync(join(dist, 'assets', name), randomBytes(kb * 1024)),
  );
  return dist;
};
const check = (dist, ...budget) =>
  spawnSync('node', [script, '--dist', dist, ...budget], { encoding: 'utf8' });

it('passes when the JavaScript and the CSS are under budget', () => {
  const result = check(
    distWith({ 'index-a.js': 40, 'index-b.css': 5 }),
    '--js-kb',
    '50',
    '--css-kb',
    '10',
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/js +\d+ KB gzip \/ 50 KB/);
});

it('fails when the JavaScript goes over budget, and says by how much', () => {
  const result = check(
    distWith({ 'index-a.js': 40, 'chunk-c.js': 20 }),
    '--js-kb',
    '50',
    '--css-kb',
    '10',
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/js is \d+ KB over its 50 KB budget/);
});

it('fails when the CSS goes over budget', () => {
  const result = check(
    distWith({ 'index-a.js': 1, 'index-b.css': 20 }),
    '--js-kb',
    '50',
    '--css-kb',
    '10',
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/css is \d+ KB over its 10 KB budget/);
});

const withIndex = (dist, ...entries) => {
  writeFileSync(
    join(dist, 'index.html'),
    `<script type="module" src="/assets/${entries[0]}"></script>` +
      entries
        .slice(1)
        .map((name) => `<link rel="modulepreload" href="/assets/${name}">`)
        .join(''),
  );
  return dist;
};

it('budgets the entry chunks that index.html loads apart from the lazy chunks', () => {
  const dist = withIndex(
    distWith({ 'index-a.js': 30, 'vendor-b.js': 15, 'DatePicker-c.js': 40 }),
    'index-a.js',
    'vendor-b.js',
  );
  const result = check(dist, '--js-kb', '50', '--lazy-kb', '45', '--css-kb', '10');
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/js +4[5-6] KB gzip \/ 50 KB \(entry\)/);
  expect(result.stdout).toMatch(/lazy +4[0-1] KB gzip \/ 45 KB/);
});

it('fails when the lazy chunks go over their own budget', () => {
  const dist = withIndex(distWith({ 'index-a.js': 10, 'DatePicker-c.js': 40 }), 'index-a.js');
  const result = check(dist, '--js-kb', '50', '--lazy-kb', '30', '--css-kb', '10');
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/lazy is \d+ KB over its 30 KB budget/);
});

it('finds the entry under any base path and attribute quoting', () => {
  const dist = distWith({ 'index-a.js': 30, 'DatePicker-c.js': 40 });
  writeFileSync(
    join(dist, 'index.html'),
    `<script type=module src='/app/assets/index-a.js'></script>`,
  );
  const result = check(dist, '--js-kb', '50', '--lazy-kb', '45', '--css-kb', '10');
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/js +3[0-1] KB gzip \/ 50 KB \(entry\)/);
});

it('fails closed when index.html names no entry chunk, instead of passing on 0 KB', () => {
  const dist = distWith({ 'index-a.js': 30 });
  writeFileSync(
    join(dist, 'index.html'),
    '<script type="module" src="/elsewhere/main.js"></script>',
  );
  const result = check(dist, '--js-kb', '50', '--lazy-kb', '45', '--css-kb', '10');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('index.html loads none of the built JavaScript');
});

it('fails clearly when there is no build to measure', () => {
  const result = check(join(tmpdir(), 'no-such-dist'));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('run npm run build first');
});

/** Runs the real no-debug script inside a throwaway git repo for each case. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('check-no-debug.mjs', import.meta.url));

const tempDirs = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const runIn = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'no-debug-'));
  tempDirs.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  Object.entries(files).forEach(([file, content]) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  });
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('check-no-debug', () => {
  it('passes clean source', () => {
    expect(runIn({ 'src/a.ts': 'export const a = 1;\n' }).status).toBe(0);
  });

  it.each([
    ['a standalone debugger statement', '  debugger;\n', 'debugger'],
    ['an inline debugger statement', 'if (ready) { debugger; }\n', 'debugger'],
    ['console.log', "console.log('x');\n", 'console.log'],
    ['a to-do marker', '// TODO: later\n', 'TODO'],
    ['a fix-me marker', '// FIXME\n', 'FIXME'],
  ])('fails on %s and names the file and line', (_label, line, rule) => {
    const { status, output } = runIn({ 'src/a.ts': `export const a = 1;\n${line}` });

    expect(status).toBe(1);
    expect(output).toContain(`src/a.ts:2: ${rule}`);
  });

  it('skips git-ignored files and prose files', () => {
    const leftover = 'TODO\n';
    const { status } = runIn({
      'docs/NOTES.md': leftover,
      'README.md': leftover,
      '.gitignore': 'dist/\n',
      'dist/bundle.js': leftover,
    });

    expect(status).toBe(0);
  });
});

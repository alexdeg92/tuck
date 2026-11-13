#!/usr/bin/env node
/**
 * Fails when debug leftovers (console.log, debugger statements, to-do or fix-me markers)
 * appear in source, test or config files. Portable: Node only, no grep or shell features.
 * Scans tracked files plus new untracked ones that are not git-ignored.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.sql',
  '.css',
  '.html',
]);
const EXCLUDED = [/(^|\/)node_modules\//, /(^|\/)dist\//, /(^|\/)package-lock\.json$/];
// The script and its test name the patterns they look for, so they skip themselves.
const SELF = new Set(['scripts/check-no-debug.mjs', 'scripts/check-no-debug.test.mjs']);

const RULES = [
  { name: 'console.log', pattern: /\bconsole\.log\s*\(/ },
  // A debugger statement ends with `;` or the line (ASI), standalone or inline.
  { name: 'debugger', pattern: /\bdebugger\s*(;|$)/ },
  { name: 'TODO', pattern: /\bTODO\b/ },
  { name: 'FIXME', pattern: /\bFIXME\b/ },
];

const listFiles = () =>
  execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);

const isScanned = (file) =>
  !SELF.has(file) &&
  existsSync(file) &&
  SCANNED_EXTENSIONS.has(extname(file)) &&
  !EXCLUDED.some((pattern) => pattern.test(file));

const findViolations = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      RULES.filter(({ pattern }) => pattern.test(line)).map(
        ({ name }) => `${file}:${String(index + 1)}: ${name}`,
      ),
    );

const violations = listFiles().filter(isScanned).flatMap(findViolations);

if (violations.length > 0) {
  process.stderr.write(`Debug leftovers found:\n${violations.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('No debug leftovers found.\n');

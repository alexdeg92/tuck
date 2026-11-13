import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Migration = { version: number; name: string };

const FILE_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

const toMigration = (name: string): Migration => {
  const version = FILE_NAME.exec(name)?.[1];
  if (version === undefined) throw new Error(`Migration "${name}" must be named NNN_name.sql`);
  return { version: Number(version), name };
};

/**
 * Versions must be exactly 1..n. The runners record a migration by its version, so two files
 * with one number (two branches that both added "004") would silently skip one of them, and a
 * gap means one was lost in a merge. Either stops the boot, and the test suite, at once.
 */
const checkSequence = (migrations: Migration[]): Migration[] => {
  migrations.forEach(({ version, name }, index) => {
    const previous = migrations[index - 1];
    if (previous?.version === version) {
      throw new Error(
        `Migrations ${previous.name} and ${name} share the number ${String(version).padStart(3, '0')}: renumber one`,
      );
    }
    if (version !== index + 1) {
      throw new Error(`Migration ${String(index + 1).padStart(3, '0')} is missing before ${name}`);
    }
  });
  return migrations;
};

export const listMigrations = (dir: string): Migration[] =>
  checkSequence(
    readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map(toMigration)
      .sort((a, b) => a.version - b.version || a.name.localeCompare(b.name)),
  );

export const readMigration = (dir: string, { name }: Migration): string =>
  readFileSync(join(dir, name), 'utf8');

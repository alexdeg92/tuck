export const TRASH_RETENTION_DAYS = 30;

const RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const purgeAtOf = (deletedAt: string): string =>
  new Date(Date.parse(deletedAt) + RETENTION_MS).toISOString();

export const purgeCutoff = (now: Date): string =>
  new Date(now.getTime() - RETENTION_MS).toISOString();

import { describe, expect, it } from 'vitest';
import { purgeAtOf, purgeCutoff, TRASH_RETENTION_DAYS } from './trash';

describe('trash retention', () => {
  it('keeps a trashed task for 30 days', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it('purges a task exactly the retention period after it was deleted', () => {
    expect(purgeAtOf('2026-11-12T10:00:00.000Z')).toBe('2026-12-12T10:00:00.000Z');
  });

  it('counts days of 24 hours in UTC, across month ends and leap days', () => {
    expect(purgeAtOf('2028-02-10T23:59:59.999Z')).toBe('2028-03-11T23:59:59.999Z');
  });

  it('puts the purge cutoff the retention period before now', () => {
    expect(purgeCutoff(new Date('2026-12-12T10:00:00.000Z'))).toBe('2026-11-12T10:00:00.000Z');
  });

  it('is due exactly when purgeAt has arrived', () => {
    const deletedAt = '2026-11-12T10:00:00.000Z';
    const now = new Date(purgeAtOf(deletedAt));
    expect(deletedAt <= purgeCutoff(now)).toBe(true);
    expect(deletedAt <= purgeCutoff(new Date(now.getTime() - 1))).toBe(false);
  });
});

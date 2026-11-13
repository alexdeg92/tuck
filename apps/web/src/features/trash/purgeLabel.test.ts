import { describe, expect, it } from 'vitest';
import { purgeLabel } from './purgeLabel';

const PURGE_AT = '2026-12-12T10:00:00.000Z';
const at = (iso: string) => new Date(iso);

describe('purgeLabel (display only: the server owns purgeAt)', () => {
  it.each([
    ['30 days ahead', '2026-11-12T10:00:00.000Z', 'Deletes in 30 days'],
    ['just over a day ahead', '2026-12-11T09:59:59.000Z', 'Deletes in 2 days'],
    ['exactly a day ahead', '2026-12-11T10:00:00.000Z', 'Deletes today'],
    ['an hour ahead', '2026-12-12T09:00:00.000Z', 'Deletes today'],
    [
      'past purgeAt (the hourly purge has not run yet)',
      '2026-12-12T10:30:00.000Z',
      'Deletes today',
    ],
  ])('%s → %s', (_label, now, expected) => {
    expect(purgeLabel(PURGE_AT, at(now)).text).toBe(expected);
  });

  it('rounds up, so the last 24 hours read as today and anything longer as at least 2 days', () => {
    expect(purgeLabel(PURGE_AT, at('2026-12-11T09:00:00.000Z')).text).toBe('Deletes in 2 days');
  });

  it('flags the last day and gives the full date for an accessible description', () => {
    const label = purgeLabel(PURGE_AT, at('2026-12-12T09:00:00.000Z'));
    expect(label.today).toBe(true);
    expect(label.full).toMatch(/Dec(ember)? 12, 2026/);
  });
});

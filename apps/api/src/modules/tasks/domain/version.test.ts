import { describe, expect, it } from 'vitest';
import { nextUpdatedAt } from './version';

describe('nextUpdatedAt', () => {
  it('uses the clock when it has moved on', () => {
    expect(nextUpdatedAt('2026-11-11T09:30:00.000Z', '2026-11-11T10:00:00.000Z')).toBe(
      '2026-11-11T10:00:00.000Z',
    );
  });

  it('moves 1 ms past the stored stamp when the clock repeats or goes back', () => {
    expect(nextUpdatedAt('2026-11-11T09:30:00.000Z', '2026-11-11T09:30:00.000Z')).toBe(
      '2026-11-11T09:30:00.001Z',
    );
    expect(nextUpdatedAt('2026-11-11T09:30:00.000Z', '2026-11-11T09:00:00.000Z')).toBe(
      '2026-11-11T09:30:00.001Z',
    );
  });
});

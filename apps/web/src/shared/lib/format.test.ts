import { describe, expect, it } from 'vitest';
import { formatDueDate, formatPriority, isDueDateOverdue } from './format';

describe('format helpers', () => {
  it('formats calendar due dates without a time zone shift', () => {
    expect(formatDueDate('2026-11-20', '2026-11-11')).toBe('Due Nov 20');
    expect(formatDueDate(null)).toBeNull();
  });

  it('marks overdue due dates with the danger label', () => {
    expect(isDueDateOverdue('2026-11-01', '2026-11-11')).toBe(true);
    expect(isDueDateOverdue('2026-11-11', '2026-11-11')).toBe(false);
    expect(formatDueDate('2026-11-01', '2026-11-11')).toBe('Overdue · Nov 1');
  });

  it('capitalises priority labels', () => {
    expect(formatPriority('high')).toBe('High');
    expect(formatPriority('medium')).toBe('Medium');
    expect(formatPriority('low')).toBe('Low');
  });
});

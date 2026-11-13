import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('keeps the set names in order and skips the rest', () => {
    expect(cx('a', false, undefined, null, '', 'b')).toBe('a b');
  });
});

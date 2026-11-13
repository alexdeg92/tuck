import { describe, expect, it } from 'vitest';
import { keyBetween } from './ordering';

describe('keyBetween', () => {
  it('produces keys that sort between their neighbours in byte order', () => {
    const first = keyBetween(null, null);
    const top = keyBetween(null, first);
    const middle = keyBetween(top, first);
    const last = keyBetween(first, null);

    expect([last, first, middle, top].sort()).toEqual([top, middle, first, last]);
  });

  it('keeps finding room in the same gap', () => {
    const keys = Array.from({ length: 50 }).reduce<string[]>(
      (acc) => [...acc, keyBetween(acc.at(-1) ?? null, 'a1')],
      ['a0'],
    );
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

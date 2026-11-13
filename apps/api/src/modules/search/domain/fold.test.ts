import { describe, expect, it } from 'vitest';
import { fold, foldWithMap, tokens } from './fold';

describe('fold', () => {
  it.each([
    ['École', 'ecole'],
    ['ECOLE', 'ecole'],
    ['Crème brûlée', 'creme brulee'],
    ['ΟΣ', 'οσ'],
    ['ος', 'οσ'],
    ['İSTANBUL', 'istanbul'],
    ['straße', 'straße'],
  ])(
    '%s -> %s (case and accent insensitive, Greek final sigma, Turkish dotted İ)',
    (input, folded) => {
      expect(fold(input)).toBe(folded);
    },
  );
});

describe('foldWithMap', () => {
  it('maps folded ranges back to the original text, even when folding changes lengths', () => {
    const original = 'Cre\u0300me';
    const { folded, toOriginal } = foldWithMap(original);

    expect(folded).toBe('creme');
    expect(toOriginal(3, 5)).toEqual([4, 6]);
    expect(original.slice(...toOriginal(0, 3))).toBe('Cre\u0300');
  });
});

describe('tokens', () => {
  it('splits folded text on anything that is not a letter or a digit', () => {
    expect(tokens('Buy oat-milk, 2 EGGS!')).toEqual(['buy', 'oat', 'milk', '2', 'eggs']);
  });

  it('keeps CJK letters and drops emoji and punctuation', () => {
    expect(tokens('猫 cat 🐱 <mark>%_')).toEqual(['猫', 'cat', 'mark']);
  });
});

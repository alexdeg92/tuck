import type { Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { matchesFilter } from './listFilter';

const task = (title: string, notes = ''): Pick<Task, 'title' | 'notes'> => ({ title, notes });

describe('matchesFilter (the plain list filter)', () => {
  it.each([
    ['', true],
    ['oat mi', true],
    ['OAT MILK', true],
    ['ecole', true],
    ['50%', true],
    ['barista', true],
    ['mlik', false],
    ['milk oat', false],
  ])('q=%j -> %s: one literal substring, accents and case folded, no typos', (q, expected) => {
    expect(matchesFilter(task('Oat milk for École', '50% the barista one'), q)).toBe(expected);
  });
});

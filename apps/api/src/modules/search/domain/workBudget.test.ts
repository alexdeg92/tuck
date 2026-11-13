import { describe, expect, it } from 'vitest';
import { spend, workBudget } from './workBudget';

describe('work budget', () => {
  it('reserves work while it fits, and records what was spent', () => {
    const budget = workBudget(10);

    expect(spend(budget, 4)).toBe(true);
    expect(spend(budget, 6)).toBe(true);
    expect(budget).toEqual({ limit: 10, spent: 10, exhausted: false });
  });

  it('refuses work that would go over, without spending it, and stays exhausted', () => {
    const budget = workBudget(10);
    spend(budget, 8);

    expect(spend(budget, 3)).toBe(false);
    expect(budget).toEqual({ limit: 10, spent: 8, exhausted: true });
    expect(spend(budget, 1)).toBe(false);
  });
});

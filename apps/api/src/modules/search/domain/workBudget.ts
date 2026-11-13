export type WorkBudget = { readonly limit: number; spent: number; exhausted: boolean };

export const SEARCH_WORK_LIMIT = 2_000_000;

export const workBudget = (limit: number = SEARCH_WORK_LIMIT): WorkBudget => ({
  limit,
  spent: 0,
  exhausted: false,
});

export const spend = (budget: WorkBudget, cost: number): boolean => {
  if (budget.exhausted || budget.spent + cost > budget.limit) {
    budget.exhausted = true;
    return false;
  }
  budget.spent += cost;
  return true;
};

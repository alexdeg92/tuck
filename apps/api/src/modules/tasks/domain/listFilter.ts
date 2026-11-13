import { foldForSearch, type Task } from '@todo/contracts';

/**
 * The list's plain filter (GET /api/tasks?q=): one literal substring of the title or the notes,
 * with accents and case folded. No typos, no ranking and no budget: it reads each task once, so
 * it can't be cut short. Smart search (words, typos, snippets) is GET /api/search.
 */
export const matchesFilter = (
  { title, notes }: Pick<Task, 'title' | 'notes'>,
  q: string,
): boolean => {
  const needle = foldForSearch(q);
  return foldForSearch(title).includes(needle) || foldForSearch(notes).includes(needle);
};

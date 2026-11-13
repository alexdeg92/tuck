import type { ItemHighlights, SearchField, Task, TaskHighlights } from '@todo/contracts';
import type { Range } from './ranges';
import { type Corpus, fieldOf, rangesOfField, resolveQuery, spellingsOf } from './smartSearch';
import { spend, type WorkBudget, workBudget } from './workBudget';

export const taskHighlights = (
  corpus: Corpus,
  task: Task,
  rawQuery: string,
  budget: WorkBudget = workBudget(),
): TaskHighlights => {
  const { query, mode, terms } = resolveQuery(corpus, rawQuery, budget);
  const spellings = mode === 'none' ? [] : spellingsOf(terms);
  let complete = true;

  const mark = (field: SearchField, itemId: string | null, text: () => string): Range[] => {
    if (spellings.length === 0) return [];
    if (budget.exhausted) {
      complete = false;
      return [];
    }
    const value = text();
    if (value === '') return [];
    if (!spend(budget, value.length + 1)) {
      complete = false;
      return [];
    }
    const marked = rangesOfField(fieldOf(field, itemId, value), spellings, budget);
    complete &&= marked.complete;
    return marked.ranges;
  };
  const reply = (fields: TaskHighlights['fields']): TaskHighlights => ({
    taskUpdatedAt: task.updatedAt,
    query,
    mode,
    fields,
    truncated: budget.exhausted || !complete,
  });
  if (spellings.length === 0 || budget.exhausted) return reply({ title: [], notes: [], items: [] });

  const title = mark('title', null, () => task.title);
  const notes = mark('notes', null, () => task.notes);

  if (!spend(budget, corpus.items.length)) return reply({ title, notes, items: [] });
  const items = corpus.items
    .filter((item) => item.taskId === task.id)
    .map((item): ItemHighlights => ({
      itemId: item.id,
      updatedAt: item.updatedAt,
      text: mark('item', item.id, () => item.text),
      notes: mark('itemNotes', item.id, () => item.notes),
    }))
    .filter(({ text, notes: itemNotes }) => text.length + itemNotes.length > 0);
  return reply({ title, notes, items });
};

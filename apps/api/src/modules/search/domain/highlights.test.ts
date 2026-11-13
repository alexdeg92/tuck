import {
  type ChecklistItem,
  MAX_TASK_HIGHLIGHTS,
  type Task,
  TaskHighlights,
} from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { taskHighlights } from './highlights';
import type { Corpus } from './smartSearch';
import { type WorkBudget, workBudget } from './workBudget';

const NOW = '2026-11-11T09:30:00.000Z';

const task = (title: string, notes = ''): Task => ({
  id: crypto.randomUUID(),
  title,
  notes,
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  position: 'a0',
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
  checklist: { done: 0, total: 0 },
});

const item = (of: Task, text: string, notes = '', position = 'a0'): ChecklistItem => ({
  id: crypto.randomUUID(),
  taskId: of.id,
  text,
  notes,
  done: false,
  position,
  createdAt: NOW,
  updatedAt: NOW,
});

const of = (corpus: Corpus, query: string, target = corpus.tasks[0]): TaskHighlights => {
  if (target === undefined) throw new Error('no task');
  return TaskHighlights.parse(taskHighlights(corpus, target, query));
};

const marked = (text: string, ranges: [number, number][]): string[] =>
  ranges.map(([start, end]) => text.slice(start, end));

describe('taskHighlights', () => {
  it('marks every match in a long note, the title and the matching items, in order', () => {
    const notes = [
      'The budget for Q3 is tight.',
      'x'.repeat(1200),
      'Keep the travel budget apart from the event budget.',
      'x'.repeat(1200),
      'Budget review on Friday; the BUDGET owner signs off.',
    ].join(' ');
    const plan = task('Budget plan', notes);
    const receipts = item(plan, 'Collect receipts', '', 'a0');
    const check = item(plan, 'Check the budget', 'Ask finance for the budget sheet', 'a1');
    const result = of({ tasks: [plan], items: [check, receipts] }, 'budget');

    expect(result).toMatchObject({ query: 'budget', mode: 'exact', truncated: false });
    expect(result.taskUpdatedAt).toBe(NOW);
    expect(marked(plan.title, result.fields.title)).toEqual(['Budget']);
    expect(marked(notes, result.fields.notes)).toEqual([
      'budget',
      'budget',
      'budget',
      'Budget',
      'BUDGET',
    ]);
    expect(result.fields.items).toEqual([
      { itemId: check.id, updatedAt: NOW, text: [[10, 16]], notes: [[20, 26]] },
    ]);
  });

  it('merges overlapping and touching matches of different words into one range', () => {
    const notes = 'icecream and budgets';
    const result = of(
      { tasks: [task('icecream budget', notes)], items: [] },
      'budget bud ice cream',
    );

    expect(marked(notes, result.fields.notes)).toEqual(['icecream', 'budget']);
  });

  it('matches accents, case and combining marks, and points at the original text', () => {
    const notes = 'CAFÉ meeting, then update my résumé. Café again.';
    const result = of({ tasks: [task('t', notes)], items: [] }, 'cafe resume');

    expect(marked(notes, result.fields.notes)).toEqual(['CAFÉ', 'résumé', 'Café']);
  });

  it('counts UTF-16 units: emoji (surrogate pairs) before a match shift it by two each', () => {
    const notes = '🐱🐶 buy milk 👍🏽 then milk again';
    const result = of({ tasks: [task('🛒 milk run', notes)], items: [] }, 'milk');

    expect(result.fields.title).toEqual([[3, 7]]);
    expect(result.fields.notes).toEqual([
      [9, 13],
      [24, 28],
    ]);
  });

  it(`gives the first ${String(MAX_TASK_HIGHLIGHTS)} ranges of a field and says truncated`, () => {
    const many = of({ tasks: [task('a', 'a '.repeat(MAX_TASK_HIGHLIGHTS + 100))], items: [] }, 'a');
    expect(many.fields.notes).toHaveLength(MAX_TASK_HIGHLIGHTS);
    expect(many.fields.notes.at(-1)).toEqual([998, 999]);
    expect(many.truncated).toBe(true);

    const whole = of({ tasks: [task('a', 'a '.repeat(MAX_TASK_HIGHLIGHTS - 1))], items: [] }, 'a');
    expect(whole.fields.notes).toHaveLength(MAX_TASK_HIGHLIGHTS - 1);
    expect(whole.truncated).toBe(false);
  });

  it("uses the search's own spellings: its typo corrections, from the whole corpus", () => {
    const groceries = task('Groceries', 'Oat milk and more milk.');
    const corpus = { tasks: [groceries, task('Milk the cows')], items: [] };

    const result = of(corpus, 'mlik');

    expect(result.mode).toBe('fuzzy');
    expect(marked(groceries.notes, result.fields.notes)).toEqual(['milk', 'milk']);
  });

  it('stays exact when another task matches as typed, like the search does', () => {
    const typo = task('Buy mlik', '');
    const corpus = { tasks: [typo, task('Buy milk')], items: [] };

    const result = of(corpus, 'milk', typo);

    expect(result.mode).toBe('exact');
    expect(result.fields.title).toEqual([]);
  });

  it('answers no match with mode none and no ranges', () => {
    expect(of({ tasks: [task('Groceries', 'milk')], items: [] }, 'zebra')).toMatchObject({
      mode: 'none',
      fields: { title: [], notes: [], items: [] },
      truncated: false,
    });
  });

  it('marks every overlapping occurrence of one word as their union', () => {
    expect(of({ tasks: [task('t', 'banana')], items: [] }, 'ana').fields.notes).toEqual([[1, 6]]);
    expect(of({ tasks: [task('t', 'aaaaa')], items: [] }, 'aaa').fields.notes).toEqual([[0, 5]]);
  });
});

const watched = (size: number, budget: WorkBudget) => {
  const late = { reads: 0 };
  const watch = <T extends object>(value: T): T =>
    new Proxy(value, {
      get: (target, property, receiver) => {
        if (budget.exhausted && ['title', 'notes', 'text', 'taskId'].includes(String(property))) {
          late.reads += 1;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  const tasks = Array.from({ length: size }, (_, n) => watch(task(`Task ${String(n)} zzz`, 'yyy')));
  const first = tasks[0];
  if (first === undefined) throw new Error('no task');
  const items = tasks.map((owner) => watch(item(owner, 'xxx', 'www')));
  return { corpus: { tasks, items }, first, late };
};

describe('taskHighlights within the work budget', () => {
  it('reads nothing once the search has spent the budget, and says truncated', () => {
    const budget = workBudget(0);
    const { corpus, first, late } = watched(50, budget);

    const result = taskHighlights(corpus, first, 'zzz', budget);

    expect(result).toMatchObject({ fields: { title: [], notes: [], items: [] }, truncated: true });
    expect(late.reads).toBe(0);
  });

  it('stops when the budget runs out in the middle of a large corpus that does not match', () => {
    const budget = workBudget(1000);
    const { corpus, first, late } = watched(400, budget);

    const result = taskHighlights(corpus, first, 'qqqqqq', budget);

    expect(budget.exhausted).toBe(true);
    expect(result.truncated).toBe(true);
    expect(late.reads).toBe(0);
  });

  it('says truncated when the budget runs out while marking the fields', () => {
    const plan = task('Budget plan', 'budget '.repeat(300));
    const corpus = { tasks: [plan], items: [item(plan, 'budget check')] };
    const full = workBudget();
    taskHighlights(corpus, plan, 'budget', full);

    const cut = Array.from({ length: 2500 }, (_, step) =>
      taskHighlights(corpus, plan, 'budget', workBudget(full.spent - 1 - step)),
    ).filter(({ mode }) => mode === 'exact');

    expect(cut.length).toBeGreaterThan(0);
    cut.forEach((result) => {
      expect(TaskHighlights.parse(result).truncated).toBe(true);
    });
    expect(cut.some(({ fields }) => fields.notes.length === 0)).toBe(true);
  });

  it('marks a 20 000-character note quickly, capped at the per-field limit', () => {
    const plan = task('Budget plan', 'budget '.repeat(2857));
    expect(plan.notes.length).toBeLessThanOrEqual(20_000);

    const started = performance.now();
    const result = TaskHighlights.parse(
      taskHighlights({ tasks: [plan], items: [] }, plan, 'budget'),
    );
    const elapsed = performance.now() - started;

    expect(result.fields.notes).toHaveLength(MAX_TASK_HIGHLIGHTS);
    expect(result.truncated).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});

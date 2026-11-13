import { type ChecklistItem, SearchResult, type Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { type Corpus, MAX_HITS, search } from './smartSearch';
import { SEARCH_WORK_LIMIT, workBudget } from './workBudget';

const generator = (seed: number) => {
  let state = seed;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number): number => Math.floor(next() * (max + 1));
  const pick = <T>(values: readonly T[]): T => {
    const value = values[int(values.length - 1)];
    if (value === undefined) throw new Error('pick from an empty list');
    return value;
  };
  return { int, pick };
};

const NOW = '2026-11-11T09:30:00.000Z';

const WORDS = [
  'a',
  'aaaaaaaa',
  'aaaaaabb',
  'aaaabaab',
  'baaaaaab',
  'milk',
  'mlik',
  'École',
  'Crème',
  '🐱',
  'ΟΣ',
  'tail',
];

const textOf = (random: ReturnType<typeof generator>, maxLength: number): string => {
  const words: string[] = [];
  let length = 0;
  const target = random.int(maxLength);
  while (length < target) {
    const word = random.pick(WORDS);
    words.push(word);
    length += word.length + 1;
  }
  return words.join(' ').slice(0, maxLength).trim() || 'a';
};

const corpusOf = (random: ReturnType<typeof generator>, maxTasks: number): Corpus => {
  const tasks: Task[] = Array.from({ length: 1 + random.int(maxTasks - 1) }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: textOf(random, 200),
    notes: textOf(random, 5000),
    status: 'todo',
    priority: 'medium',
    dueDate: null,
    position: `a${String(index)}`,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    checklist: { done: 0, total: 0 },
  }));
  const items: ChecklistItem[] = tasks.flatMap((task, taskIndex) =>
    Array.from({ length: random.int(50) }, (_, index) => ({
      id: `00000000-0000-4000-9${String(taskIndex).padStart(3, '0')}-${String(index).padStart(12, '0')}`,
      taskId: task.id,
      text: textOf(random, 200),
      notes: textOf(random, 1000),
      done: false,
      position: `a${String(index)}`,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  );
  return { tasks, items };
};

const QUERIES = [
  'a',
  'a '.repeat(50).trim(),
  'aaaaaaaa aaaaaabb aaaabaab baaaaaab aaaaaaab aaaaaaba aaaaabaa aaaabaaa',
  'x'.repeat(100),
  'zzzzzzzz',
  'mlik ecole creme',
];

describe('search stays within its work budget (property-style)', () => {
  it.each(Array.from({ length: 12 }, (_, seed) => seed + 1))(
    'random corpus at the maxima #%d',
    (seed) => {
      const random = generator(seed);
      const corpus = corpusOf(random, 12);
      QUERIES.forEach((query) => {
        const budget = workBudget();
        const result = SearchResult.parse(search(corpus, query, budget));

        expect(budget.spent).toBeLessThanOrEqual(SEARCH_WORK_LIMIT);
        expect(result.truncated).toBe(budget.exhausted);
        expect(result.hits.length).toBeLessThanOrEqual(MAX_HITS);
      });
    },
  );

  it('returns what it found so far, marked truncated, when the budget runs out', () => {
    const corpus = corpusOf(generator(99), 12);
    const budget = workBudget(20_000);

    const result = SearchResult.parse(search(corpus, 'a', budget));

    expect(result.truncated).toBe(true);
    expect(budget.spent).toBeLessThanOrEqual(20_000);
  });

  it('answers an exhausted budget with no work: truncated, no hits', () => {
    const corpus = corpusOf(generator(7), 4);
    const budget = workBudget(0);

    expect(search(corpus, 'aaaaaaaa', budget)).toMatchObject({ hits: [], truncated: true });
    expect(budget.spent).toBe(0);
  });

  it('marks truncated when the budget is spent exactly before a stage it still needs', () => {
    const owner = corpusOf(generator(5), 1).tasks[0];
    if (owner === undefined) throw new Error('expected a task');
    const corpus = { tasks: [{ ...owner, title: 'milk', notes: '' }], items: [] };

    const budget = workBudget(35);
    const result = search(corpus, 'mlik', budget);

    expect(budget.spent).toBe(35);
    expect(result).toMatchObject({ hits: [], truncated: true });
    expect(search(corpus, 'mlik').hits).toHaveLength(1);
  });

  it('charges every field, so a corpus of many tiny fields still runs out', () => {
    const owner = corpusOf(generator(3), 1).tasks[0];
    if (owner === undefined) throw new Error('expected a task');
    const items: ChecklistItem[] = Array.from({ length: 50_000 }, (_, index) => ({
      id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
      taskId: owner.id,
      text: 'a',
      notes: '',
      done: false,
      position: `a${String(index)}`,
      createdAt: NOW,
      updatedAt: NOW,
    }));
    const budget = workBudget(50_000);

    expect(search({ tasks: [owner], items }, 'a', budget).truncated).toBe(true);
  });

  it('never truncates a realistic corpus (300 tasks, a few items each)', () => {
    const tasks: Task[] = Array.from({ length: 300 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Quarterly budget review ${String(index)}`,
      notes: 'Pull the numbers from the finance dashboard and check the forecast.',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      position: `a${String(index)}`,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      checklist: { done: 0, total: 3 },
    }));
    const items: ChecklistItem[] = tasks.flatMap((task, taskIndex) =>
      ['Collect receipts', 'Draft the slides', 'Book the room'].map((text, index) => ({
        id: `00000000-0000-4000-9${String(taskIndex).padStart(3, '0')}-${String(index).padStart(12, '0')}`,
        taskId: task.id,
        text,
        notes: '',
        done: false,
        position: `a${String(index)}`,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );

    expect(search({ tasks, items }, 'quartrely budgte').truncated).toBe(false);
    expect(search({ tasks, items }, 'slides').truncated).toBe(false);
  });

  it('stays within budget when every task holds a note at the 20 000-character maximum', () => {
    const random = generator(20);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const word = () =>
      Array.from({ length: 3 + random.int(8) }, () => letters.charAt(random.int(25))).join('');
    const longNote = () => {
      const words: string[] = [];
      let length = 0;
      while (length < 20_000) {
        const next = word();
        words.push(next);
        length += next.length + 1;
      }
      return words.join(' ').slice(0, 20_000);
    };
    const tasks: Task[] = Array.from({ length: 300 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Task ${String(index)}`,
      notes: longNote(),
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      position: `a${String(index)}`,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      checklist: { done: 0, total: 0 },
    }));

    for (const query of ['task', 'qwrtyuiop zxcvbn']) {
      const budget = workBudget();
      const started = performance.now();
      const result = SearchResult.parse(search({ tasks, items: [] }, query, budget));
      const elapsed = performance.now() - started;

      expect(budget.spent).toBeLessThanOrEqual(SEARCH_WORK_LIMIT);
      expect(result.truncated).toBe(budget.exhausted);
      expect(result.truncated).toBe(true);

      expect(elapsed).toBeLessThan(2000);
    }
  });

  it('keeps the typo pass (prefixes, sound-alikes) within budget on a large varied corpus', () => {
    const random = generator(42);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const word = () =>
      Array.from({ length: 4 + random.int(8) }, () => letters.charAt(random.int(25))).join('');
    const tasks: Task[] = Array.from({ length: 3000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: Array.from({ length: 12 }, word).join(' '),
      notes: Array.from({ length: 60 }, word).join(' '),
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      position: `a${String(index)}`,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
      checklist: { done: 0, total: 0 },
    }));
    const budget = workBudget();

    const started = performance.now();
    const result = SearchResult.parse(
      search({ tasks, items: [] }, 'qwrtyuiop phillipe zxcvbn', budget),
    );
    const elapsed = performance.now() - started;

    expect(budget.spent).toBeLessThanOrEqual(SEARCH_WORK_LIMIT);
    expect(result.truncated).toBe(budget.exhausted);

    expect(elapsed).toBeLessThan(2000);
  });
});

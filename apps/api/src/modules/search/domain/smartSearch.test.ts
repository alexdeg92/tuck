import type { ChecklistItem, Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { occurrences } from './ranges';
import { type Corpus, firstMatches, MAX_HITS, search } from './smartSearch';
import { workBudget } from './workBudget';

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

const item = (of: Task, text: string, notes = ''): ChecklistItem => ({
  id: crypto.randomUUID(),
  taskId: of.id,
  text,
  notes,
  done: false,
  position: 'a0',
  createdAt: NOW,
  updatedAt: NOW,
});

const corpusOf = (tasks: Task[], items: ChecklistItem[] = []): Corpus => ({ tasks, items });
const titles = (corpus: Corpus, query: string) =>
  search(corpus, query).hits.map(({ task: hit }) => hit.title);

describe('search: modes', () => {
  it('answers an empty or punctuation-only query with mode none and no hits', () => {
    const corpus = corpusOf([task('Milk')]);
    expect(search(corpus, '   ')).toEqual({
      query: '',
      mode: 'none',
      suggestion: null,
      hits: [],
      truncated: false,
    });
    expect(search(corpus, '%_').mode).toBe('none');
  });

  it('is exact with no suggestion when every word matches as typed', () => {
    const result = search(corpusOf([task('Buy milk')]), 'MILK');
    expect(result).toMatchObject({ query: 'MILK', mode: 'exact', suggestion: null });
    expect(result.hits).toHaveLength(1);
  });
});

describe('search: ranking', () => {
  it('ranks an exact word > a word prefix > a substring, in the title before the notes', () => {
    const corpus = corpusOf([
      task('Buttermilk pancakes'),
      task('Notes only', 'milk'),
      task('Milkshake'),
      task('Milk'),
    ]);
    expect(titles(corpus, 'milk')).toEqual([
      'Milk',
      'Milkshake',
      'Buttermilk pancakes',
      'Notes only',
    ]);
  });

  it('weighs the title above a checklist item above the notes, at the same match class', () => {
    const inItem = task('Shopping');
    const corpus = corpusOf(
      [task('Breakfast', 'eggs'), inItem, task('Eggs')],
      [item(inItem, 'Eggs')],
    );
    expect(titles(corpus, 'eggs')).toEqual(['Eggs', 'Shopping', 'Breakfast']);
  });

  it('requires every word somewhere in the task (AND across fields)', () => {
    const withItem = task('Groceries');
    const corpus = corpusOf([task('Milk'), withItem], [item(withItem, 'Oat milk')]);
    expect(titles(corpus, 'groceries milk')).toEqual(['Groceries']);
    expect(titles(corpus, 'buy milk')).toEqual([]);
  });

  it('breaks equal scores by list order', () => {
    const corpus = corpusOf([task('Call mum'), task('Call dad')]);
    expect(titles(corpus, 'call')).toEqual(['Call mum', 'Call dad']);
  });

  it('is accent- and case-insensitive, including Greek final sigma and Turkish dotted İ', () => {
    const corpus = corpusOf([task('École primaire'), task('ΟΣ'), task('İSTANBUL trip')]);
    expect(titles(corpus, 'ecole')).toEqual(['École primaire']);
    expect(titles(corpus, 'ος')).toEqual(['ΟΣ']);
    expect(titles(corpus, 'οσ')).toEqual(['ΟΣ']);
    expect(titles(corpus, 'istanbul')).toEqual(['İSTANBUL trip']);
  });
});

describe('search: matches, snippets and highlights', () => {
  it('reports where it matched, with ranges in the original text', () => {
    const dessert = task('Crème brûlée');
    const [hit] = search(corpusOf([dessert]), 'brulee').hits;
    expect(hit?.matches).toEqual([
      {
        field: 'title',
        itemId: null,
        snippet: 'Crème brûlée',
        sourceStart: 0,
        sourceEnd: 12,
        highlights: [[6, 12]],
      },
    ]);
  });

  it('points at the checklist item it matched', () => {
    const groceries = task('Groceries');
    const milk = item(groceries, 'Oat milk', 'barista');
    const [hit] = search(corpusOf([groceries], [milk]), 'oat milk').hits;
    expect(hit?.matches).toEqual([
      {
        field: 'item',
        itemId: milk.id,
        snippet: 'Oat milk',
        sourceStart: 0,
        sourceEnd: 8,
        highlights: [
          [0, 3],
          [4, 8],
        ],
      },
    ]);
  });

  it('cuts long text into a window around the match, at most 240 characters', () => {
    const long = `${'lorem ipsum '.repeat(30)}needle ${'dolor sit '.repeat(30)}`;
    const [hit] = search(corpusOf([task('Long', long)]), 'needle').hits;
    const match = hit?.matches[0];
    if (match === undefined) throw new Error('expected a match');
    const [range] = match.highlights;
    if (range === undefined) throw new Error('expected a highlight');

    expect(match.snippet.length).toBeLessThanOrEqual(240);
    expect(match.snippet.slice(...range)).toBe('needle');
  });

  /** Every match of every hit shows a non-empty, in-bounds highlight. */
  const expectVisibleHighlights = (result: ReturnType<typeof search>) => {
    expect(result.hits.length).toBeGreaterThan(0);
    result.hits.forEach(({ matches }) => {
      matches.forEach(({ snippet, highlights }) => {
        expect(highlights.length).toBeGreaterThan(0);
        highlights.forEach(([start, end]) => {
          expect(start).toBeLessThan(end);
          expect(end).toBeLessThanOrEqual(snippet.length);
        });
      });
    });
  };

  it('keeps the match inside the window even when no space is near it', () => {
    const notes = `${'x'.repeat(100)}target${'x'.repeat(100)} ${'tail '.repeat(70)}`;
    const result = search(corpusOf([task('Long', notes)]), 'target');

    expectVisibleHighlights(result);
    const match = result.hits[0]?.matches[0];
    const range = match?.highlights[0];
    expect(range === undefined ? '' : match?.snippet.slice(...range)).toBe('target');
  });

  it.each([1000, 3000, 5000])(
    'clips a match longer than the window to it (%d repeated letters)',
    (length) => {
      const result = search(corpusOf([task('Long', 'a'.repeat(length))]), 'a');
      expectVisibleHighlights(result);
      expect(result.hits[0]?.matches[0]?.snippet.length).toBeLessThanOrEqual(240);
    },
  );

  it('highlights correctly around combining marks and characters outside the BMP', () => {
    const notes = `🐱🐱 Cre\u0300me ${'🐱'.repeat(150)} brûlée`;
    expectVisibleHighlights(search(corpusOf([task('Dessert', notes)]), 'creme brulee'));
  });

  it('bounds the work per field: highlights stay inside the window', () => {
    const tasks = Array.from({ length: 50 }, (_, index) =>
      task(`Note ${String(index)}`, 'a'.repeat(5000)),
    );
    const result = search(corpusOf(tasks), 'a');

    expect(result.hits).toHaveLength(MAX_HITS);
    result.hits.forEach(({ matches }) => {
      matches.forEach(({ snippet, highlights }) => {
        expect(snippet.length).toBeLessThanOrEqual(240);
        expect(highlights.length).toBeLessThanOrEqual(snippet.length);
      });
    });
  });

  it('keeps at most 3 matches per hit and MAX_HITS hits', () => {
    const many = task('tea', 'tea');
    const items = ['tea', 'tea', 'tea'].map((text) => item(many, text, 'tea'));
    const tasks = [many, ...Array.from({ length: 60 }, () => task('tea'))];
    const result = search(corpusOf(tasks, items), 'tea');

    expect(result.hits).toHaveLength(MAX_HITS);
    expect(result.hits[0]?.matches.length).toBeLessThanOrEqual(3);
  });

  it('treats markup and wildcards in user text as plain characters', () => {
    const [hit] = search(corpusOf([task('Fix <mark> and 100% tags')]), 'mark').hits;
    expect(hit?.matches[0]?.snippet).toBe('Fix <mark> and 100% tags');
  });
});

describe('search: typo tolerance', () => {
  it.each([
    ['grocries', 'Groceries', 'Groceries'],
    ['mlik', 'Milk', 'Milk'],
    ['recieve', 'Receive', 'Receive the parcel'],
  ])('%s -> fuzzy, did you mean %s (as the task spells it)', (query, text, title) => {
    const corpus = corpusOf([task('Groceries'), task('Milk'), task('Receive the parcel')]);
    const result = search(corpus, query);

    expect(result).toMatchObject({
      mode: 'fuzzy',
      suggestion: { text, changed: [{ start: 0, end: text.length, typed: query }] },
    });
    expect(result.hits.map(({ task: hit }) => hit.title)).toEqual([title]);
  });

  it('suggests the whole corrected query and finds items through it', () => {
    const groceries = task('Groceries');
    const result = search(corpusOf([groceries], [item(groceries, 'Oat milk')]), 'oat mlik');
    expect(result).toMatchObject({
      mode: 'fuzzy',
      suggestion: { text: 'oat milk', changed: [{ start: 4, end: 8, typed: 'mlik' }] },
    });
    expect(result.hits[0]?.score).toBeGreaterThan(0);
  });

  it('scores fuzzy hits at half an exact hit', () => {
    const corpus = corpusOf([task('Milk')]);
    const exact = search(corpus, 'milk').hits[0]?.score ?? 0;
    expect(search(corpus, 'mlik').hits[0]?.score).toBe(exact / 2);
  });

  it('does not fuzz words under three letters and answers none when nothing comes close', () => {
    const corpus = corpusOf([task('Cat food')]);
    expect(search(corpus, 'ct')).toEqual({
      query: 'ct',
      mode: 'none',
      suggestion: null,
      hits: [],
      truncated: false,
    });
    expect(search(corpus, 'zzzzzz').mode).toBe('none');
  });

  it('fuzzes three-letter words by one typo', () => {
    expect(search(corpusOf([task('Cat food')]), 'cta')).toMatchObject({
      mode: 'fuzzy',
      suggestion: { text: 'Cat' },
    });
  });
});

/** The suggestion's changed words, as the UI underlines them. */
const underlined = (query: string, corpus: Corpus): string[] => {
  const suggestion = search(corpus, query).suggestion;
  return (suggestion?.changed ?? []).map(
    ({ start, end }) => suggestion?.text.slice(start, end) ?? '',
  );
};

describe('search: typos ported from an earlier search engine (prefix, transposition, accents, sound-alike)', () => {
  const people = corpusOf([
    task('Call Ian Bouchard'),
    task('Trembaly invoice'),
    task('Lunch with Camille'),
    task('Gift for Filipe'),
    task('Meet Kentin'),
    task('ÉLÈNE Roy birthday'),
    task('Renew passport', 'Photos are in the top drawer.'),
    task('Phone the bank'),
  ]);

  it.each([
    ['yan', 'Ian'], // substitution, three letters
    ['tremblay', 'Trembaly'], // adjacent transposition
    ['camile', 'Camille'], // a missing letter
    ['phillippe', 'Filipe'], // sound-alike: ph -> f, doubled letters
    ['qentin', 'Kentin'], // a typo the plain distance catches
    ['fone', 'Phone'], // sound-alike only: two edits away for a four-letter word
    ['drwe', 'drawer'], // half-typed with a typo: matched against the start of the word
  ])('%s -> did you mean %s', (query, word) => {
    expect(underlined(query, people)).toEqual([word]);
  });

  it('folds accents before anything else: an accent-free query is exact', () => {
    expect(search(people, 'elene')).toMatchObject({ mode: 'exact', suggestion: null });
  });

  it('corrects only the misspelt word of several, and keeps the rest as typed', () => {
    const result = search(people, 'bouchrad ian');
    expect(result.suggestion).toEqual({
      text: 'Bouchard ian',
      changed: [{ start: 0, end: 8, typed: 'bouchrad' }],
    });
    expect(result.hits.map(({ task: hit }) => hit.title)).toEqual(['Call Ian Bouchard']);
  });

  it('keeps a half-typed word that already starts a known word as typed', () => {
    expect(search(people, 'phon bnak').suggestion).toEqual({
      text: 'phon bank',
      changed: [{ start: 5, end: 9, typed: 'bnak' }],
    });
  });

  it.each(['ian absent', 'zzzzzz', 'bouchard royale'])(
    'needs every word to match somewhere: %s -> none',
    (query) => {
      expect(search(people, query).mode).toBe('none');
    },
  );

  it.each(['mlik 2', 'mlik2', 'ian@bouchrad', 'bouchrad #1'])(
    'runs no typo pass for a query with digits or symbols: %s',
    (query) => {
      expect(search(corpusOf([task('Milk'), task('Call Ian Bouchard')]), query).mode).toBe('none');
    },
  );

  it('still corrects words joined by a hyphen or an apostrophe', () => {
    expect(search(corpusOf([task('Oat milk')]), 'oat-mlik').mode).toBe('fuzzy');
    expect(search(corpusOf([task("Ian's milk")]), "ian's mlik").mode).toBe('fuzzy');
  });
});

describe('occurrences', () => {
  it('collects every occurrence from a start up to a bound, never more ranges than fit', () => {
    expect(occurrences('a milk, oat milk', 'milk', 0, 100)).toEqual([
      [2, 6],
      [12, 16],
    ]);
    expect(occurrences('a milk, oat milk', 'milk', 0, 10)).toEqual([[2, 6]]);
    const ranges = occurrences('a'.repeat(5000), 'a', 0, 240);
    expect(ranges).toHaveLength(240);
  });

  it('finds overlapping occurrences of the same word', () => {
    expect(occurrences('banana', 'ana', 0, 100)).toEqual([
      [1, 4],
      [3, 6],
    ]);
    expect(occurrences('aaaaa', 'aaa', 0, 100)).toHaveLength(3);
  });
});

describe('search: overlapping matches of one word', () => {
  it('marks their union in the snippet and counts it once', () => {
    const [hit] = search(corpusOf([task('Fruit', 'banana bread')]), 'ana').hits;
    expect(hit?.matches[0]?.highlights).toEqual([[1, 6]]);
    expect(hit?.matchCount).toEqual({ value: 1, exact: true });
  });
});

describe('bounded match building', () => {
  it('builds matches field by field and stops at the limit', () => {
    let built = 0;
    const matches = firstMatches(
      Array.from({ length: 100 }, (_, index) => index),
      (field) => {
        built += 1;
        return field % 2 === 0 ? field : undefined;
      },
      3,
    );

    expect(matches).toEqual([0, 2, 4]);
    expect(built).toBe(5);
  });

  it('counts a repeated query word once: same hits and scores as the single word', () => {
    const corpus = corpusOf([task('Buy milk'), task('Milk', 'milk milk')]);
    expect(search(corpus, 'milk milk milk').hits).toEqual(search(corpus, 'milk').hits);
  });
});

describe('search: match counts and snippet source', () => {
  it('counts every match in the task, over every field, beyond the snippets', () => {
    const notes = ['budget', 'x'.repeat(600), 'budget budget', 'x'.repeat(600), 'Budget BUDGET'];
    const groceries = task('Budget for groceries', notes.join(' '));
    const items = [item(groceries, 'Check the budget'), item(groceries, 'budget', 'budget')];
    const hit = search(corpusOf([groceries], items), 'budget').hits[0];

    expect(hit?.matchCount).toEqual({ value: 9, exact: true });
    expect(hit?.sourceCounts).toEqual({
      notes: { value: 5, exact: true },
      checklist: { value: 3, exact: true },
    });
    expect(hit?.matches).toHaveLength(3);
  });

  it('counts touching matches of two words once (one highlighted range)', () => {
    expect(search(corpusOf([task('icecream')]), 'ice cream').hits[0]?.matchCount).toEqual({
      value: 1,
      exact: true,
    });
  });

  it('marks the count as a lower bound when a field has more matches than it lists', () => {
    const hit = search(corpusOf([task('a', 'a '.repeat(600))]), 'a').hits[0];
    expect(hit?.matchCount).toEqual({ value: 501, exact: false });
    expect(hit?.sourceCounts).toEqual({
      notes: { value: 500, exact: false },
      checklist: { value: 0, exact: true },
    });
  });

  it('marks the count as a lower bound when the work budget stops the counting', () => {
    const corpus = corpusOf([task('milk', 'milk '.repeat(400))]);
    const full = workBudget();
    search(corpus, 'milk', full);
    // The largest budget that still returns the hit but cannot finish counting its notes.
    const results = Array.from({ length: 100 }, (_, step) =>
      search(corpus, 'milk', workBudget(full.spent - 1 - 50 * step)),
    );
    const partial = results.find(({ hits }) => hits[0]?.matchCount.exact === false);

    expect(partial?.truncated).toBe(true);
    expect(partial?.hits[0]?.matchCount.value).toBeLessThan(401);
  });

  it("gives each snippet's place in the field's original text", () => {
    const notes = `${'Long intro. '.repeat(30)}Here: buy oat milk today. ${'More text. '.repeat(30)}`;
    const match = search(corpusOf([task('Groceries', notes)]), 'milk').hits[0]?.matches[0];
    if (match === undefined) throw new Error('expected a match');

    expect(notes.slice(match.sourceStart, match.sourceEnd)).toBe(match.snippet);
    expect(match.sourceStart).toBeGreaterThan(0);
  });
});

describe('search: the suggestion names words the results contain', () => {
  const corpus = corpusOf([
    task('Call Ian about the Lisbon flat'),
    task('Buy a can opener'),
    task('Can recycling day'),
    task('Recycle the can of paint'),
  ]);

  it('takes the correction the top result contains, not the most frequent one', () => {
    const result = search(corpus, 'yan lisbon');
    expect(result.hits.map(({ task: hit }) => hit.title)).toEqual([
      'Call Ian about the Lisbon flat',
    ]);
    expect(result.suggestion).toEqual({
      text: 'Ian lisbon',
      changed: [{ start: 0, end: 3, typed: 'yan' }],
    });
  });

  it('never corrects a word to a token with digits (a code, a number)', () => {
    expect(search(corpusOf([task('Door', 'pin4821 for the side door')]), 'pinz').mode).toBe('none');
  });

  it("keeps the user's query as written, swapping only the corrected words", () => {
    const people = corpusOf([task("Camille's résumé"), task('Oat milk'), task('Résumé review')]);
    expect(search(people, "Camille's resme").suggestion).toEqual({
      text: "Camille's résumé",
      changed: [{ start: 10, end: 16, typed: 'resme' }],
    });
    expect(search(people, 'Oat-mlik').suggestion).toEqual({
      text: 'Oat-milk',
      changed: [{ start: 4, end: 8, typed: 'mlik' }],
    });
    expect(search(people, 'RESME').suggestion?.changed).toEqual([
      { start: 0, end: 6, typed: 'RESME' },
    ]);
  });

  it('corrects words separated by commas and periods; refuses only digits, @ and #', () => {
    const shop = corpusOf([task('Groceries and milk'), task('Kitchen'), task('Call Ian Bouchard')]);
    expect(search(shop, 'grocries, milk').mode).toBe('fuzzy');
    expect(search(shop, 'milk. grocries').mode).toBe('fuzzy');
    ['kitchn 2', 'ian@bouchrad', 'bouchrad #1'].forEach((query) => {
      expect(search(shop, query).mode, query).toBe('none');
    });
  });
});

describe('search: a correction that starts a word of the top result', () => {
  it('suggests that word as the top result spells it, not the folded correction', () => {
    const corpus = corpusOf([task('Drawer Lisbon'), task('Draw elsewhere')]);
    const result = search(corpus, 'drwa lisbon');

    expect(result.hits[0]?.task.title).toBe('Drawer Lisbon');
    expect(result.suggestion).toEqual({
      text: 'Drawer lisbon',
      changed: [{ start: 0, end: 6, typed: 'drwa' }],
    });
  });
});

describe('search: order (open first, then relevance, then matches, then list position)', () => {
  const done = (title: string, notes = ''): Task => ({
    ...task(title, notes),
    status: 'done',
    completedAt: NOW,
  });
  const titles = (result: ReturnType<typeof search>) =>
    result.hits.map(({ task: hit }) => hit.title);

  it('lists open tasks before completed ones, even a completed task that scores higher', () => {
    const corpus = corpusOf([done('Milk'), task('Shopping', 'buy milk')]);
    expect(titles(search(corpus, 'milk'))).toEqual(['Shopping', 'Milk']);
  });

  it('keeps every open match among the returned hits when completed ones would crowd them out', () => {
    const completed = Array.from({ length: MAX_HITS + 5 }, (_, n) => done(`Milk ${String(n)}`));
    const result = search(corpusOf([...completed, task('Shopping', 'buy milk')]), 'milk');
    expect(result.hits[0]?.task.title).toBe('Shopping');
    expect(result.hits).toHaveLength(MAX_HITS);
  });

  it('breaks a tie in relevance by the number of matches, then by list position', () => {
    const corpus = corpusOf([
      task('Milk', 'one'),
      task('Milk run', 'milk and more milk'),
      task('Milk again', 'two'),
    ]);
    expect(titles(search(corpus, 'milk'))).toEqual(['Milk run', 'Milk', 'Milk again']);
  });
});

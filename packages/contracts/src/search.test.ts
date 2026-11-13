import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_HIGHLIGHTS,
  RelatedTasks,
  SearchHit,
  SearchMatch,
  SearchQuery,
  SearchResult,
  SearchSuggestion,
  TaskHighlights,
} from './search';
import { foldForSearch, searchTerms } from './searchText';
import { ListTasksQuery } from './tasks';

const example = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../examples/${file}`, import.meta.url), 'utf8'));

describe('SearchQuery', () => {
  it('trims q and defaults it to empty', () => {
    expect(SearchQuery.parse({ q: '  oat milk ' })).toEqual({ q: 'oat milk' });
    expect(SearchQuery.parse({})).toEqual({ q: '' });
  });

  it('caps q at 100 characters and 8 different words (repeats count once)', () => {
    expect(SearchQuery.safeParse({ q: 'x'.repeat(100) }).success).toBe(true);
    expect(SearchQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: 'a b c d e f g h' }).success).toBe(true);
    expect(SearchQuery.safeParse({ q: 'a b c d e f g h i' }).success).toBe(false);
    expect(SearchQuery.safeParse({ q: 'milk '.repeat(19).trim() }).success).toBe(true);
    expect(SearchQuery.safeParse({ q: 'Milk MILK milk' }).success).toBe(true);
  });
});

describe('one definition of search words (shared by the schema and the API)', () => {
  it('folds accents, case and final sigma', () => {
    expect(foldForSearch('École CAFÉ ΟΣ İSTANBUL')).toBe('ecole cafe οσ istanbul');
  });

  it('splits on anything that is not a letter or a digit, and counts repeats once', () => {
    expect(searchTerms('Oat-milk, 2 EGGS; oat')).toEqual(['oat', 'milk', '2', 'eggs']);
    expect(searchTerms('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(searchTerms('  %_ ')).toEqual([]);
  });

  it.each([
    ['spaces', 'a b c d e f g h i'],
    ['commas', 'a,b,c,d,e,f,g,h,i'],
    ['hyphens', 'a-b-c-d-e-f-g-h-i'],
  ])('rejects nine different words separated by %s, on q', (_label, q) => {
    const result = SearchQuery.safeParse({ q });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['q']);
  });

  it('counts folded repeats once', () => {
    expect(SearchQuery.safeParse({ q: 'École ecole ECOLE a b c d e f g' }).success).toBe(true);
  });

  it('applies the same caps to the list filter', () => {
    expect(ListTasksQuery.safeParse({ q: 'x'.repeat(100) }).success).toBe(true);
    expect(ListTasksQuery.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(ListTasksQuery.safeParse({ q: 'a,b,c,d,e,f,g,h,i' }).success).toBe(false);
  });
});

describe('SearchResult', () => {
  it('parses the example', () => {
    expect(SearchResult.parse(example('search-result.json')).mode).toBe('fuzzy');
  });

  it('caps matches at 3 per hit and hits at 50', () => {
    const result = SearchResult.parse(example('search-result.json'));
    const hit = result.hits[0];
    if (hit === undefined) throw new Error('example has a hit');
    const match = hit.matches[0];
    expect(SearchHit.safeParse({ ...hit, matches: [match, match, match, match] }).success).toBe(
      false,
    );
    expect(
      SearchResult.safeParse({ ...result, hits: Array.from({ length: 51 }, () => hit) }).success,
    ).toBe(false);
  });

  it('says when the work budget cut the search short (false by default)', () => {
    const result = SearchResult.parse(example('search-result.json'));
    expect(result.truncated).toBe(false);
    expect(SearchResult.parse({ ...result, truncated: undefined }).truncated).toBe(false);
    expect(SearchResult.parse({ ...result, truncated: true }).truncated).toBe(true);
  });

  it('rejects an unknown mode or field', () => {
    const result = SearchResult.parse(example('search-result.json'));
    expect(SearchResult.safeParse({ ...result, mode: 'semantic' }).success).toBe(false);
  });
});

describe('RelatedTasks', () => {
  it('holds at most 3 tasks', () => {
    const related = RelatedTasks.parse(example('related-tasks.json'));
    const task = related.items[0];
    expect(RelatedTasks.safeParse({ items: [task, task, task, task] }).success).toBe(false);
  });
});

describe('SearchHit match count and snippet source', () => {
  const hit = (): SearchHit => {
    const first = SearchResult.parse(example('search-result.json')).hits[0];
    if (first === undefined) throw new Error('example has a hit');
    return first;
  };

  it('counts matches over the whole task, saying whether the count is exact', () => {
    expect(hit().matchCount).toEqual({ value: 2, exact: true });
    expect(SearchHit.safeParse({ ...hit(), matchCount: { value: 9, exact: false } }).success).toBe(
      true,
    );
  });

  it('refuses a count that is negative, fractional or missing', () => {
    [{ value: -1, exact: true }, { value: 1.5, exact: true }, undefined].forEach((matchCount) => {
      expect(SearchHit.safeParse({ ...hit(), matchCount }).success).toBe(false);
    });
  });

  it("places each snippet in its field's original text", () => {
    const match = hit().matches[0];
    expect(match).toMatchObject({ snippet: 'Oat milk', sourceStart: 0, sourceEnd: 8 });
  });

  it('refuses a source window that does not fit the snippet', () => {
    const match = hit().matches[0];
    expect(SearchMatch.safeParse({ ...match, sourceEnd: 9 }).success).toBe(false);
    expect(SearchMatch.safeParse({ ...match, sourceStart: 2, sourceEnd: 0 }).success).toBe(false);
  });
});

describe('TaskHighlights', () => {
  const highlights = (): TaskHighlights => TaskHighlights.parse(example('task-highlights.json'));

  it('parses the example: ranges over the whole title, notes and matching items', () => {
    expect(highlights()).toMatchObject({ query: 'budget', mode: 'exact', truncated: false });
    expect(highlights().fields.notes.length).toBeGreaterThan(1);
    expect(highlights().fields.items[0]?.text).toEqual([[10, 16]]);
  });

  it(`caps each field at ${String(MAX_TASK_HIGHLIGHTS)} ranges`, () => {
    const ranges = Array.from({ length: MAX_TASK_HIGHLIGHTS + 1 }, (_, i): [number, number] => [
      2 * i,
      2 * i + 1,
    ]);
    const withNotes = (notes: [number, number][]) => ({
      ...highlights(),
      fields: { ...highlights().fields, notes },
    });
    expect(TaskHighlights.safeParse(withNotes(ranges.slice(1))).success).toBe(true);
    expect(TaskHighlights.safeParse(withNotes(ranges)).success).toBe(false);
  });

  it.each([
    ['empty', [[3, 3]]],
    ['backwards', [[5, 2]]],
    [
      'out of order',
      [
        [10, 12],
        [0, 2],
      ],
    ],
    [
      'overlapping',
      [
        [0, 5],
        [4, 8],
      ],
    ],
    [
      'touching (should be merged)',
      [
        [0, 4],
        [4, 8],
      ],
    ],
  ])('refuses ranges that are %s', (_label, title) => {
    const value = { ...highlights(), fields: { ...highlights().fields, title } };
    expect(TaskHighlights.safeParse(value).success).toBe(false);
  });

  it('says when the task was last saved, so stale ranges can be dropped', () => {
    expect(highlights().taskUpdatedAt).toBe('2026-11-11T09:30:00.000Z');
    expect(TaskHighlights.safeParse({ ...highlights(), taskUpdatedAt: 'now' }).success).toBe(false);
  });
});

describe('SearchSuggestion ("Did you mean …")', () => {
  const suggestion = (): SearchSuggestion => {
    const parsed = SearchResult.parse(example('search-result.json')).suggestion;
    if (parsed === null) throw new Error('example has a suggestion');
    return parsed;
  };

  it('gives the corrected query and where each changed word sits in it', () => {
    const { text, changed } = suggestion();
    expect(text).toBe('oat milk');
    expect(changed).toEqual([{ start: 4, end: 8, typed: 'mlik' }]);
    expect(changed.map(({ start, end }) => text.slice(start, end))).toEqual(['milk']);
  });

  it.each([
    ['past the end of the text', [{ start: 4, end: 9, typed: 'mlik' }]],
    ['empty', [{ start: 4, end: 4, typed: 'mlik' }]],
    [
      'out of order',
      [
        { start: 4, end: 8, typed: 'mlik' },
        { start: 0, end: 3, typed: 'oaat' },
      ],
    ],
    ['without the typed word', [{ start: 4, end: 8, typed: '' }]],
  ])('refuses a changed word that is %s', (_label, changed) => {
    expect(SearchSuggestion.safeParse({ text: 'oat milk', changed }).success).toBe(false);
  });

  it('is null when nothing was corrected', () => {
    expect(
      SearchResult.parse({ ...SearchResult.parse(example('search-result.json')), suggestion: null })
        .suggestion,
    ).toBeNull();
  });
});

describe('SearchHit source counts ("3 matches in notes" under the title)', () => {
  const hit = (): SearchHit => {
    const first = SearchResult.parse(example('search-result.json')).hits[0];
    if (first === undefined) throw new Error('example has a hit');
    return first;
  };

  it('counts matches in the notes and in the checklist (text and notes of every item)', () => {
    expect(hit().sourceCounts).toEqual({
      notes: { value: 0, exact: true },
      checklist: { value: 2, exact: true },
    });
  });

  it('requires both counts, each a MatchCount', () => {
    const { sourceCounts } = hit();
    expect(SearchHit.safeParse({ ...hit(), sourceCounts: undefined }).success).toBe(false);
    expect(
      SearchHit.safeParse({
        ...hit(),
        sourceCounts: { ...sourceCounts, notes: { value: -1, exact: true } },
      }).success,
    ).toBe(false);
    expect(
      SearchHit.safeParse({ ...hit(), sourceCounts: { notes: sourceCounts.notes } }).success,
    ).toBe(false);
  });
});

import {
  type ChecklistItem,
  type Highlight,
  MAX_TASK_HIGHLIGHTS,
  type MatchCount,
  type SearchField,
  type SearchHit,
  type SearchMatch,
  type SearchMode,
  type SearchResult,
  type SearchSuggestion,
  searchTerms,
  type Task,
} from '@todo/contracts';
import { fold, foldWithMap, type Span, spans } from './fold';
import { merge, occurrences, type Range, rangesIn, type Spelling } from './ranges';
import { type Correction, corrections } from './typos';
import { spend, type WorkBudget, workBudget } from './workBudget';

export type Corpus = { tasks: Task[]; items: ChecklistItem[] };

export const MAX_HITS = 20;
const MAX_MATCHES = 3;
const SNIPPET_MAX = 240;
const SNIPPET_CONTEXT = 60;
const FUZZY_FACTOR = 0.5;

const WEIGHT: Record<SearchField, number> = { title: 3, item: 2, notes: 1, itemNotes: 1 };

const EXACT_WORD = 4;
const WORD_PREFIX = 3;
const SUBSTRING = 2;

export type Field = {
  field: SearchField;
  itemId: string | null;
  text: string;

  folded: string;
  words: Span[];
};

export type Term = Spelling[];

export const spellingsOf = (terms: Term[]): Spelling[] => {
  const byText = new Map<string, boolean>();
  terms.flat().forEach(({ text, wordStart }) => {
    byText.set(text, (byText.get(text) ?? true) && wordStart);
  });
  return [...byText].map(([text, wordStart]) => ({ text, wordStart }));
};

export const fieldOf = (field: SearchField, itemId: string | null, text: string): Field => {
  const folded = fold(text);
  return { field, itemId, text, folded, words: spans(folded) };
};

const fieldsOf = (task: Task, items: ChecklistItem[]): Field[] =>
  [
    fieldOf('title', null, task.title),
    fieldOf('notes', null, task.notes),
    ...items.flatMap((item) => [
      fieldOf('item', item.id, item.text),
      fieldOf('itemNotes', item.id, item.notes),
    ]),
  ].filter(({ text }) => text !== '');

const matchClass = ({ text, wordStart }: Spelling, { folded, words }: Field): number =>
  words.some(({ token }) => token === text)
    ? EXACT_WORD
    : words.some(({ token }) => token.startsWith(text))
      ? WORD_PREFIX
      : !wordStart && folded.includes(text)
        ? SUBSTRING
        : 0;

const termScore = (term: Term, fields: Field[]): number =>
  Math.max(
    0,
    ...fields.flatMap((field) => term.map((s) => WEIGHT[field.field] * matchClass(s, field))),
  );

/** Every term must match somewhere (AND); the score adds up each term's best match. */
const taskScore = (terms: Term[], fields: Field[]): number | undefined => {
  const scores = terms.map((term) => termScore(term, fields));
  return scores.every((score) => score > 0)
    ? scores.reduce((sum, score) => sum + score, 0)
    : undefined;
};

const isLowSurrogate = (text: string, index: number): boolean => {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
};

const window = (text: string, matchStart: number, matchEnd: number): [number, number] => {
  if (text.length <= SNIPPET_MAX) return [0, text.length];
  const roughStart = Math.max(0, matchStart - SNIPPET_CONTEXT);
  const space = text.indexOf(' ', roughStart);
  const snapped = roughStart > 0 && space !== -1 && space < matchStart ? space + 1 : roughStart;
  const start = isLowSurrogate(text, snapped) ? snapped + 1 : snapped;
  const roughEnd = Math.min(text.length, start + SNIPPET_MAX);
  const lastSpace = text.lastIndexOf(' ', roughEnd);
  const end = roughEnd < text.length && lastSpace >= matchEnd ? lastSpace : roughEnd;
  return [start, end < text.length && isLowSurrogate(text, end) ? end - 1 : end];
};

const matchIn = (field: Field, spellings: Spelling[]): SearchMatch | undefined => {
  const first = spellings
    .flatMap(({ text, wordStart }) =>
      occurrences(field.folded, text, 0, field.folded.length, 1, wordStart),
    )
    .sort((a, b) => a[0] - b[0])[0];
  if (first === undefined) return undefined;
  const { toOriginal } = foldWithMap(field.text);
  const [matchStart, matchEnd] = toOriginal(first[0], first[1]);
  const [start, end] = window(field.text, matchStart, matchEnd);

  const until = first[0] + 2 * SNIPPET_MAX;
  const highlights: Highlight[] = merge(
    spellings.flatMap(({ text, wordStart }) =>
      occurrences(field.folded, text, first[0], until, Number.POSITIVE_INFINITY, wordStart),
    ),
  )
    .map(([from, to]) => toOriginal(from, to))
    .map(([from, to]): Highlight => [Math.max(from, start) - start, Math.min(to, end) - start])
    .filter(([from, to]) => from < to);
  return {
    field: field.field,
    itemId: field.itemId,
    snippet: field.text.slice(start, end),
    sourceStart: start,
    sourceEnd: end,
    highlights,
  };
};

type Candidate = { task: Task; fields: Field[]; index: number; cost: number };
type Scored = Candidate & { score: number };

const candidateWithin = (
  task: Task,
  index: number,
  items: ChecklistItem[],
  budget: WorkBudget,
): Candidate | undefined => {
  const length =
    task.title.length +
    task.notes.length +
    items.reduce((sum, item) => sum + item.text.length + item.notes.length, 0);
  if (!spend(budget, length + 2 + 2 * items.length)) return undefined;
  const fields = fieldsOf(task, items);
  const cost = fields.reduce((sum, { words, folded }) => sum + words.length + folded.length, 0);
  return { task, fields, index, cost };
};

const isOpen = ({ task }: Scored): boolean => task.status !== 'done';

const ranksBefore = (a: Scored, b: Scored): boolean =>
  isOpen(a) !== isOpen(b) ? isOpen(a) : a.score > b.score;

const scoreWithin = (
  candidates: Candidate[],
  terms: Term[],
  factor: number,
  budget: WorkBudget,
): Scored[] => {
  const spellings = terms.reduce((count, term) => count + term.length, 0);

  let best: Scored[] = [];
  for (const candidate of candidates) {
    if (!spend(budget, spellings * candidate.cost + MAX_HITS)) break;
    const score = taskScore(terms, candidate.fields);
    if (score === undefined) continue;
    const scored = { ...candidate, score: score * factor };
    const at = best.findIndex((kept) => ranksBefore(scored, kept));
    best = (
      at === -1 ? [...best, scored] : [...best.slice(0, at), scored, ...best.slice(at)]
    ).slice(0, MAX_HITS);
  }
  return best;
};

export const firstMatches = <F, M>(
  fields: F[],
  matchOf: (field: F) => M | undefined,
  limit: number,
): M[] => {
  const found: M[] = [];
  for (const field of fields) {
    if (found.length >= limit) break;
    const match = matchOf(field);
    if (match !== undefined) found.push(match);
  }
  return found;
};

export const rangesOfField = (
  field: Field,
  spellings: Spelling[],
  budget: WorkBudget,
): { ranges: Range[]; complete: boolean } => {
  if (!spend(budget, field.folded.length * spellings.length + 1)) {
    return { ranges: [], complete: false };
  }
  const { toOriginal } = foldWithMap(field.text);
  const { ranges, truncated } = rangesIn(field.folded, spellings, MAX_TASK_HIGHLIGHTS);

  return { ranges: merge(ranges.map(([from, to]) => toOriginal(from, to))), complete: !truncated };
};

const sumOf = (counted: { field: Field; ranges: Range[]; complete: boolean }[]): MatchCount =>
  counted.reduce<MatchCount>(
    (count, { ranges, complete }) => ({
      value: count.value + ranges.length,
      exact: count.exact && complete,
    }),
    { value: 0, exact: true },
  );

const CHECKLIST_FIELDS: ReadonlySet<SearchField> = new Set(['item', 'itemNotes']);

const toHits = (scored: Scored[], terms: Term[], budget: WorkBudget): SearchHit[] => {
  const spellings = spellingsOf(terms);
  const hits = scored.map(({ task, fields, score }) => {
    const counted = fields.map((field) => ({ field, ...rangesOfField(field, spellings, budget) }));
    return {
      task,
      score,
      matchCount: sumOf(counted),
      sourceCounts: {
        notes: sumOf(counted.filter(({ field }) => field.field === 'notes')),
        checklist: sumOf(counted.filter(({ field }) => CHECKLIST_FIELDS.has(field.field))),
      },
      matches: firstMatches(
        fields,
        (field) =>
          spend(budget, field.text.length * (spellings.length + 1))
            ? matchIn(field, spellings)
            : undefined,
        MAX_MATCHES,
      ),
    };
  });

  return hits.sort(
    (a, b) =>
      Number(a.task.status === 'done') - Number(b.task.status === 'done') ||
      b.score - a.score ||
      b.matchCount.value - a.matchCount.value,
  );
};

const vocabularyWithin = (candidates: Candidate[], budget: WorkBudget): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const { fields } of candidates) {
    const words = fields.reduce((sum, field) => sum + field.words.length, 0);
    if (!spend(budget, words)) break;
    new Set(fields.flatMap((field) => field.words.map(({ token }) => token))).forEach((word) => {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    });
  }
  return counts;
};

export const groupItemsByTask = (items: ChecklistItem[]): Map<string, ChecklistItem[]> =>
  items.reduce(
    (groups, item) => groups.set(item.taskId, [...(groups.get(item.taskId) ?? []), item]),
    new Map<string, ChecklistItem[]>(),
  );

const NOT_WORDS = /[\p{N}@#]/u;

const spelledAs = (token: string, { fields }: Scored, budget: WorkBudget): string => {
  const find = (matches: (word: string) => boolean) => {
    for (const field of fields) {
      const span = field.words.find(({ token: word }) => matches(word));
      if (span !== undefined) return { field, span };
    }
    return undefined;
  };
  const found = find((word) => word === token) ?? find((word) => word.startsWith(token));
  if (found !== undefined && spend(budget, found.field.text.length)) {
    const [start, end] = foldWithMap(found.field.text).toOriginal(found.span.start, found.span.end);
    return found.field.text.slice(start, end);
  }
  return token;
};

const suggestionOf = (
  query: string,
  words: string[],
  fixes: Correction[][],
  hits: Scored[],
  budget: WorkBudget,
): SearchSuggestion | null => {
  const [top] = hits;
  if (top === undefined) return null;
  const has = (spelling: Spelling) => top.fields.some((field) => matchClass(spelling, field) > 0);
  const swaps = new Map<string, string>();
  words.forEach((word, index) => {
    if (has({ text: word, wordStart: false })) return;
    const fix = fixes[index]?.find(({ word: known }) => has({ text: known, wordStart: true }));
    if (fix !== undefined && (fix.typos > 0 || fix.soundAlike)) {
      swaps.set(word, spelledAs(fix.word, top, budget));
    }
  });
  if (swaps.size === 0) return null;

  const { folded, toOriginal } = foldWithMap(query);
  const changed: SearchSuggestion['changed'] = [];
  let text = '';
  let copied = 0;
  for (const { token, start: foldedStart, end: foldedEnd } of spans(folded)) {
    const swap = swaps.get(token);
    if (swap === undefined) continue;
    const [start, end] = toOriginal(foldedStart, foldedEnd);
    text += query.slice(copied, start);
    changed.push({
      start: text.length,
      end: text.length + swap.length,
      typed: query.slice(start, end),
    });
    text += swap;
    copied = end;
  }
  return { text: text + query.slice(copied), changed };
};

export type Resolved = {
  query: string;
  mode: SearchMode;
  suggestion: SearchSuggestion | null;
  terms: Term[];
  hits: Scored[];
};

export const resolveQuery = (corpus: Corpus, rawQuery: string, budget: WorkBudget): Resolved => {
  const query = rawQuery.trim();
  const none = (terms: Term[] = []): Resolved => ({
    query,
    mode: 'none',
    suggestion: null,
    terms,
    hits: [],
  });

  if (!spend(budget, query.length)) return none();
  const words = searchTerms(query);
  if (words.length === 0 || !spend(budget, corpus.items.length)) return none();

  const itemsByTask = groupItemsByTask(corpus.items);
  const candidates: Candidate[] = [];
  for (const [index, task] of corpus.tasks.entries()) {
    const candidate = candidateWithin(task, index, itemsByTask.get(task.id) ?? [], budget);
    if (candidate === undefined) break;
    candidates.push(candidate);
  }

  const exactTerms = words.map((word): Term => [{ text: word, wordStart: false }]);
  const exact = scoreWithin(candidates, exactTerms, 1, budget);
  if (exact.length > 0) {
    return { query, mode: 'exact', suggestion: null, terms: exactTerms, hits: exact };
  }

  if (NOT_WORDS.test(query)) return none();

  if (!spend(budget, 1)) return none();
  const vocabulary = vocabularyWithin(candidates, budget);
  const fixes = words.map((word) => corrections(word, vocabulary, budget));
  const terms = words.map((word, index): Term => [
    { text: word, wordStart: false },
    ...(fixes[index] ?? []).map(({ word: known }) => ({ text: known, wordStart: true })),
  ]);
  const fuzzy = scoreWithin(candidates, terms, FUZZY_FACTOR, budget);
  if (fuzzy.length === 0) return none(terms);
  return {
    query,
    mode: 'fuzzy',
    suggestion: suggestionOf(query, words, fixes, fuzzy, budget),
    terms,
    hits: fuzzy,
  };
};

export const search = (
  corpus: Corpus,
  rawQuery: string,
  budget: WorkBudget = workBudget(),
): SearchResult => {
  const { query, mode, suggestion, terms, hits } = resolveQuery(corpus, rawQuery, budget);
  const found = toHits(hits, terms, budget);
  return { query, mode, suggestion, hits: found, truncated: budget.exhausted };
};

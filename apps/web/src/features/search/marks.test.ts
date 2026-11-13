import type { ChecklistItem, SearchMatch, Task, TaskHighlights } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import {
  counterText,
  sourceSummaries,
  highlightView,
  segment,
  sourceName,
  step,
  titleRanges,
} from './marks';

const ITEM = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ITEM = '7b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const AT = '2026-11-12T10:00:00.000Z';
const LATER = '2026-11-12T11:00:00.000Z';

const match = (overrides: Partial<SearchMatch>): SearchMatch => ({
  field: 'notes',
  itemId: null,
  snippet: 'buy a budget planner',
  sourceStart: 0,
  sourceEnd: 20,
  highlights: [[6, 12]],
  ...overrides,
});

describe('segment', () => {
  it('splits text into plain and marked runs, numbering marks from `first`', () => {
    expect(
      segment(
        'a budget, a BUDGET',
        [
          [2, 8],
          [12, 18],
        ],
        3,
      ),
    ).toEqual([
      { text: 'a ', mark: null },
      { text: 'budget', mark: 3 },
      { text: ', a ', mark: null },
      { text: 'BUDGET', mark: 4 },
    ]);
  });

  it('marks the first and the last character and leaves no empty runs', () => {
    expect(
      segment('café', [
        [0, 1],
        [3, 4],
      ]),
    ).toEqual([
      { text: 'c', mark: 0 },
      { text: 'af', mark: null },
      { text: 'é', mark: 1 },
    ]);
  });

  it('keeps an emoji before a hit whole (UTF-16 offsets, not code points)', () => {
    expect(segment('🙂 budget', [[3, 9]])).toEqual([
      { text: '🙂 ', mark: null },
      { text: 'budget', mark: 0 },
    ]);
  });

  it('renders HTML-looking text as plain text runs', () => {
    expect(segment('<b>x</b>', [[3, 4]])).toEqual([
      { text: '<b>', mark: null },
      { text: 'x', mark: 0 },
      { text: '</b>', mark: null },
    ]);
  });

  it('returns the whole text unmarked for no ranges', () => {
    expect(segment('plain', [])).toEqual([{ text: 'plain', mark: null }]);
    expect(segment('', [])).toEqual([]);
  });
});

describe('sourceSummaries', () => {
  const itemMatch = match({
    field: 'item',
    itemId: ITEM,
    snippet: 'budget',
    sourceEnd: 6,
    highlights: [[0, 6]],
  });

  it('says how many times the notes and the checklist matched, notes first, from server counts', () => {
    expect(
      sourceSummaries([match({}), itemMatch], {
        notes: { value: 3, exact: true },
        checklist: { value: 1, exact: true },
      }),
    ).toEqual(['3 matches in notes', '1 match in checklist']);
  });

  it('marks lower bounds and hides an exact zero', () => {
    expect(
      sourceSummaries([match({})], {
        notes: { value: 500, exact: false },
        checklist: { value: 0, exact: true },
      }),
    ).toEqual(['500+ matches in notes']);
    expect(
      sourceSummaries([match({})], {
        notes: { value: 1, exact: false },
        checklist: { value: 0, exact: true },
      }),
    ).toEqual(['1+ matches in notes']);
  });

  it('never turns an unknown zero into a number: only the source, if the server matched it', () => {
    expect(
      sourceSummaries([match({})], {
        notes: { value: 0, exact: false },
        checklist: { value: 0, exact: false },
      }),
    ).toEqual(['Matches in notes']);
  });
});

describe('titleRanges', () => {
  it('maps the title match onto the whole title through its source window', () => {
    const title = match({
      field: 'title',
      snippet: 'budget',
      sourceStart: 27,
      sourceEnd: 33,
      highlights: [[0, 6]],
    });
    expect(titleRanges([title, match({})])).toEqual([[27, 33]]);
  });

  it('is empty when the title did not match', () => {
    expect(titleRanges([match({})])).toEqual([]);
  });
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c',
  title: 'Plan the budget',
  notes: 'budget here and budget there',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  position: 'a0',
  createdAt: AT,
  updatedAt: AT,
  completedAt: null,
  checklist: { done: 0, total: 1 },
  ...overrides,
});

const item = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: ITEM,
  taskId: task().id,
  text: 'Budget sheet',
  notes: 'see budget',
  done: false,
  position: 'a0',
  createdAt: AT,
  updatedAt: AT,
  ...overrides,
});

const map = (overrides: Partial<TaskHighlights> = {}): TaskHighlights => ({
  taskUpdatedAt: AT,
  query: 'budget',
  mode: 'exact',
  fields: {
    title: [[9, 15]],
    notes: [
      [0, 6],
      [16, 22],
    ],
    items: [{ itemId: ITEM, updatedAt: AT, text: [[0, 6]], notes: [[4, 10]] }],
  },
  truncated: false,
  ...overrides,
});

describe('highlightView', () => {
  it('lists every occurrence in document order: title, notes, then each item text and notes', () => {
    const view = highlightView(map(), task(), [item()]);
    expect(view.status).toBe('ready');
    expect(view.occurrences.map((o) => [o.source.kind, o.range])).toEqual([
      ['title', [9, 15]],
      ['notes', [0, 6]],
      ['notes', [16, 22]],
      ['itemText', [0, 6]],
      ['itemNotes', [4, 10]],
    ]);
    expect(view.items).toEqual([{ item: item(), text: [[0, 6]], notes: [[4, 10]], first: 3 }]);
  });

  it('applies nothing from a map of another task revision', () => {
    const view = highlightView(map({ taskUpdatedAt: LATER }), task(), [item()]);
    expect(view).toMatchObject({ status: 'updating', occurrences: [] });
  });

  it('drops a changed item and pauses the exact counter, keeping the other marks', () => {
    const view = highlightView(map(), task(), [item({ updatedAt: LATER })]);
    expect(view.status).toBe('updating');
    expect(view.occurrences.map((o) => o.source.kind)).toEqual(['title', 'notes', 'notes']);
    expect(view.items).toEqual([]);
  });

  it('calls current-revision item ranges that overrun the item text invalid, not updating', () => {
    const view = highlightView(
      map({
        fields: {
          title: [],
          notes: [],
          items: [{ itemId: ITEM, updatedAt: AT, text: [[0, 100]], notes: [] }],
        },
      }),
      task(),
      [item()],
    );
    expect(view).toMatchObject({ status: 'invalid', occurrences: [] });
  });

  it('treats a deleted item as stale and waits for the checklist before an exact count', () => {
    expect(highlightView(map(), task(), []).status).toBe('updating');
    expect(highlightView(map(), task(), undefined).status).toBe('updating');
  });

  it('needs no checklist when no item matched', () => {
    const view = highlightView(
      map({ fields: { title: [], notes: [[0, 6]], items: [] } }),
      task(),
      undefined,
    );
    expect(view.status).toBe('ready');
  });

  it('discards a map whose ranges do not fit the saved text', () => {
    const view = highlightView(
      map({ fields: { title: [[0, 99]], notes: [], items: [] } }),
      task(),
      [],
    );
    expect(view).toMatchObject({ status: 'invalid', occurrences: [] });
  });

  it('keeps items in the map order, numbering marks across them', () => {
    const second = item({ id: OTHER_ITEM, text: 'budget again', notes: '' });
    const view = highlightView(
      map({
        fields: {
          title: [],
          notes: [],
          items: [
            { itemId: ITEM, updatedAt: AT, text: [[0, 6]], notes: [] },
            { itemId: OTHER_ITEM, updatedAt: AT, text: [[0, 6]], notes: [] },
          ],
        },
      }),
      task(),
      [second, item()],
    );
    expect(view.items.map((entry) => [entry.item.id, entry.first])).toEqual([
      [ITEM, 0],
      [OTHER_ITEM, 1],
    ]);
  });
});

describe('step', () => {
  it('moves and wraps in both directions, saying when it wrapped', () => {
    expect(step(0, 3, 1)).toEqual({ index: 1, wrapped: null });
    expect(step(2, 3, 1)).toEqual({ index: 0, wrapped: 'first' });
    expect(step(0, 3, -1)).toEqual({ index: 2, wrapped: 'last' });
  });
});

describe('counterText and sourceName', () => {
  it('shows a plus on a truncated map, never an exact-looking total', () => {
    expect(counterText(0, 5, false)).toBe('1 of 5');
    expect(counterText(4, 500, true)).toBe('5 of 500+');
  });

  it('names where a match is', () => {
    expect(sourceName({ kind: 'title' })).toBe('Title');
    expect(sourceName({ kind: 'notes' })).toBe('Notes');
    expect(sourceName({ kind: 'itemText', itemId: ITEM })).toBe('Checklist item');
    expect(sourceName({ kind: 'itemNotes', itemId: ITEM })).toBe('Checklist item note');
  });
});

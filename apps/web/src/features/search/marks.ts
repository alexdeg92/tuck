import type {
  ChecklistItem,
  ChecklistItemId,
  Highlight,
  SearchHit,
  SearchMatch,
  Task,
  TaskHighlights,
} from '@todo/contracts';

export type Segment = { text: string; mark: number | null };

export function segment(text: string, ranges: readonly Highlight[], first = 0): Segment[] {
  const { runs, end } = ranges.reduce<{ runs: Segment[]; end: number }>(
    (acc, [start, stop], index) => ({
      runs: [
        ...acc.runs,
        { text: text.slice(acc.end, start), mark: null },
        { text: text.slice(start, stop), mark: first + index },
      ],
      end: stop,
    }),
    { runs: [], end: 0 },
  );
  return [...runs, { text: text.slice(end), mark: null }].filter((run) => run.text !== '');
}

export function titleRanges(matches: readonly SearchMatch[]): Highlight[] {
  const title = matches.find((match) => match.field === 'title');
  return title === undefined
    ? []
    : title.highlights.map(([start, end]): Highlight => [
        start + title.sourceStart,
        end + title.sourceStart,
      ]);
}

const SOURCES = [
  { key: 'notes', where: 'in notes', fields: ['notes'] },
  { key: 'checklist', where: 'in checklist', fields: ['item', 'itemNotes'] },
] as const;

export function sourceSummaries(
  matches: readonly SearchMatch[],
  counts: SearchHit['sourceCounts'],
): string[] {
  return SOURCES.flatMap(({ key, where, fields }) => {
    const count = counts[key];
    if (count.value > 0) {
      const plural = count.value === 1 && count.exact ? 'match' : 'matches';
      return [`${String(count.value)}${count.exact ? '' : '+'} ${plural} ${where}`];
    }
    if (count.exact) return [];
    const matched = matches.some((match) => (fields as readonly string[]).includes(match.field));
    return matched ? [`Matches ${where}`] : [];
  });
}

export type Source =
  | { kind: 'title' }
  | { kind: 'notes' }
  | { kind: 'itemText'; itemId: ChecklistItemId }
  | { kind: 'itemNotes'; itemId: ChecklistItemId };

export type Occurrence = { source: Source; range: Highlight };

export type MarkedItem = {
  item: ChecklistItem;
  text: Highlight[];
  notes: Highlight[];
  first: number;
};

export type HighlightView = {
  status: 'ready' | 'updating' | 'invalid';
  occurrences: Occurrence[];
  items: MarkedItem[];
};

const fits = (text: string, ranges: readonly Highlight[]) =>
  ranges.every(([start, end]) => start < end && end <= text.length);

/**
 * What of a highlight map may be shown over the task and checklist the user sees. The task's
 * revision guards the title and notes; each item's own `updatedAt` guards its ranges, because
 * editing an item leaves the task's revision unchanged.
 */
export function highlightView(
  map: TaskHighlights,
  task: Task,
  checklist: readonly ChecklistItem[] | undefined,
): HighlightView {
  const empty = { occurrences: [], items: [] };
  if (map.taskUpdatedAt !== task.updatedAt) return { status: 'updating', ...empty };
  const { title, notes, items } = map.fields;
  if (!fits(task.title, title) || !fits(task.notes, notes)) return { status: 'invalid', ...empty };

  const current = items.flatMap((entry) => {
    const item = checklist?.find((candidate) => candidate.id === entry.itemId);
    return item?.updatedAt === entry.updatedAt
      ? [{ item, text: entry.text, notes: entry.notes }]
      : [];
  });
  if (
    current.some(
      ({ item, text, notes: itemNotes }) => !fits(item.text, text) || !fits(item.notes, itemNotes),
    )
  ) {
    return { status: 'invalid', ...empty };
  }
  const head: Occurrence[] = [
    ...title.map((range): Occurrence => ({ source: { kind: 'title' }, range })),
    ...notes.map((range): Occurrence => ({ source: { kind: 'notes' }, range })),
  ];
  const { marked, occurrences } = current.reduce<{
    marked: MarkedItem[];
    occurrences: Occurrence[];
  }>(
    (acc, entry) => ({
      marked: [...acc.marked, { ...entry, first: acc.occurrences.length }],
      occurrences: [
        ...acc.occurrences,
        ...entry.text.map((range): Occurrence => ({
          source: { kind: 'itemText', itemId: entry.item.id },
          range,
        })),
        ...entry.notes.map((range): Occurrence => ({
          source: { kind: 'itemNotes', itemId: entry.item.id },
          range,
        })),
      ],
    }),
    { marked: [], occurrences: head },
  );
  return {
    status: current.length === items.length ? 'ready' : 'updating',
    occurrences,
    items: marked,
  };
}

export function step(
  current: number,
  total: number,
  direction: 1 | -1,
): { index: number; wrapped: 'first' | 'last' | null } {
  const index = (current + direction + total) % total;
  const wrapped =
    direction === 1 && index < current
      ? 'first'
      : direction === -1 && index > current
        ? 'last'
        : null;
  return { index, wrapped };
}

export const counterText = (index: number, total: number, truncated: boolean): string =>
  `${String(index + 1)} of ${String(total)}${truncated ? '+' : ''}`;

export function sourceName(source: Source): string {
  switch (source.kind) {
    case 'title':
      return 'Title';
    case 'notes':
      return 'Notes';
    case 'itemText':
      return 'Checklist item';
    case 'itemNotes':
      return 'Checklist item note';
  }
}

import { z } from 'zod';
import { ChecklistItemId } from './checklist';
import { SearchText } from './searchText';
import { Task } from './tasks';

export const SearchQuery = z.object({ q: SearchText });
export type SearchQuery = z.infer<typeof SearchQuery>;

export const Highlight = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
export type Highlight = z.infer<typeof Highlight>;

export const SearchField = z.enum(['title', 'notes', 'item', 'itemNotes']);
export type SearchField = z.infer<typeof SearchField>;

export const SearchMatch = z
  .object({
    field: SearchField,

    itemId: ChecklistItemId.nullable(),
    snippet: z.string().max(240),

    sourceStart: z.number().int().min(0),
    sourceEnd: z.number().int().min(0),
    highlights: z.array(Highlight),
  })
  .refine(({ snippet, sourceStart, sourceEnd }) => sourceEnd - sourceStart === snippet.length, {
    message: 'The source window must be exactly the snippet',
    path: ['sourceEnd'],
  });
export type SearchMatch = z.infer<typeof SearchMatch>;

export const MAX_TASK_HIGHLIGHTS = 500;

export const MatchCount = z.object({ value: z.number().int().min(0), exact: z.boolean() });
export type MatchCount = z.infer<typeof MatchCount>;

export const SearchHit = z.object({
  task: Task,
  score: z.number().min(0),
  matchCount: MatchCount,

  sourceCounts: z.object({ notes: MatchCount, checklist: MatchCount }),
  matches: z.array(SearchMatch).max(3),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchMode = z.enum(['exact', 'fuzzy', 'none']);
export type SearchMode = z.infer<typeof SearchMode>;

export const SuggestedWord = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  typed: z.string().min(1),
});
export type SuggestedWord = z.infer<typeof SuggestedWord>;

export const SearchSuggestion = z
  .object({ text: z.string(), changed: z.array(SuggestedWord).min(1) })
  .refine(
    ({ text, changed }) =>
      changed.every(
        ({ start, end }, index) =>
          start < end && end <= text.length && start >= (changed[index - 1]?.end ?? 0),
      ),
    { message: 'Changed words must be non-empty ranges of the text, in order', path: ['changed'] },
  );
export type SearchSuggestion = z.infer<typeof SearchSuggestion>;

export const SearchResult = z.object({
  query: z.string(),
  mode: SearchMode,

  suggestion: SearchSuggestion.nullable(),
  hits: z.array(SearchHit).max(50),

  truncated: z.boolean().default(false),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const RelatedTasks = z.object({ items: z.array(Task).max(3) });
export type RelatedTasks = z.infer<typeof RelatedTasks>;

const FieldHighlights = z
  .array(Highlight)
  .max(MAX_TASK_HIGHLIGHTS)
  .refine(
    (ranges) =>
      ranges.every(([start, end], index) => start < end && start > (ranges[index - 1]?.[1] ?? -1)),
    { message: 'Ranges must be non-empty, sorted and apart' },
  );

export const ItemHighlights = z.object({
  itemId: ChecklistItemId,
  updatedAt: z.iso.datetime(),
  text: FieldHighlights,
  notes: FieldHighlights,
});
export type ItemHighlights = z.infer<typeof ItemHighlights>;

export const TaskHighlights = z.object({
  taskUpdatedAt: z.iso.datetime(),
  query: z.string(),
  mode: SearchMode,
  fields: z.object({
    title: FieldHighlights,
    notes: FieldHighlights,
    items: z.array(ItemHighlights).max(50),
  }),

  truncated: z.boolean(),
});
export type TaskHighlights = z.infer<typeof TaskHighlights>;

import { z } from 'zod';

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_WORDS = 8;

export const SEARCH_WORD = /[\p{L}\p{N}]+/gu;

export const foldForSearch = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ς', 'σ');

export const searchTerms = (query: string): string[] => [
  ...new Set(foldForSearch(query).match(SEARCH_WORD) ?? []),
];

export const SearchText = z
  .string()
  .trim()
  .max(SEARCH_MAX_LENGTH)
  .refine((q) => searchTerms(q).length <= SEARCH_MAX_WORDS, {
    message: `Search for at most ${String(SEARCH_MAX_WORDS)} different words`,
  })
  .default('');

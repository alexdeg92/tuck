import { generateKeyBetween } from 'fractional-indexing';

export type KeyBetween = (before: string | null, after: string | null) => string;

export const keyBetween: KeyBetween = (before, after) => generateKeyBetween(before, after);

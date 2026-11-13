export type Range = [number, number];

/**
 * A text that counts as a query word. A typo correction (`wordStart`) counts only as a whole word
 * or the start of one: "can" for "cna" must not light up "scan". The word as typed counts
 * anywhere, as in the exact pass.
 */
export type Spelling = { text: string; wordStart: boolean };

const WORD_CHAR = /[\p{L}\p{N}]/u;

const startsWord = (text: string, at: number): boolean => {
  if (at === 0) return true;
  const low = text.charCodeAt(at - 1);
  const before = low >= 0xdc00 && low <= 0xdfff && at >= 2 ? text.slice(at - 2, at) : text[at - 1];
  return !WORD_CHAR.test(before ?? '');
};

export const occurrences = (
  haystack: string,
  needle: string,
  from: number,
  until: number,
  limit = Number.POSITIVE_INFINITY,
  wordStart = false,
): Range[] => {
  const found: Range[] = [];
  let at = haystack.indexOf(needle, from);
  while (at !== -1 && at < until && found.length < limit) {
    if (!wordStart || startsWord(haystack, at)) found.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + 1);
  }
  return found;
};

export const merge = (ranges: Range[]): Range[] => {
  const merged: Range[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
};

export const rangesIn = (
  folded: string,
  spellings: Spelling[],
  cap: number,
): { ranges: Range[]; truncated: boolean } => {
  let horizon = Number.POSITIVE_INFINITY;
  const found = spellings.flatMap(({ text, wordStart }) => {
    const all = occurrences(folded, text, 0, folded.length, cap + 1, wordStart);
    const cut = all[cap];
    if (cut !== undefined) horizon = Math.min(horizon, cut[0]);
    return all.slice(0, cap);
  });
  const merged = merge(found).filter(([start]) => start < horizon);
  return {
    ranges: merged.slice(0, cap),
    truncated: horizon !== Number.POSITIVE_INFINITY || merged.length > cap,
  };
};

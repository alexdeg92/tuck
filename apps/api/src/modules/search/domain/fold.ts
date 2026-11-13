import { foldForSearch, SEARCH_WORD } from '@todo/contracts';

const foldCharUncached = (char: string): string => foldForSearch(char);

const foldedChars = new Map<string, string>();
const foldChar = (char: string): string => {
  const known = foldedChars.get(char);
  if (known !== undefined) return known;
  const folded = foldCharUncached(char);
  foldedChars.set(char, folded);
  return folded;
};

const codePoints = (text: string): string[] => Array.from(text);

export const fold = (text: string): string => codePoints(text).map(foldChar).join('');

export type FoldedText = {
  folded: string;

  toOriginal: (start: number, end: number) => [number, number];
};

export const foldWithMap = (text: string): FoldedText => {
  const starts: number[] = [];
  const ends: number[] = [];
  let folded = '';
  let offset = 0;
  for (const char of codePoints(text)) {
    const end = offset + char.length;
    const piece = foldChar(char);
    if (piece === '' && ends.length > 0) {
      ends[ends.length - 1] = end;
    }
    for (let unit = 0; unit < piece.length; unit += 1) {
      starts.push(offset);
      ends.push(end);
    }
    folded += piece;
    offset = end;
  }
  return {
    folded,
    toOriginal: (from, to) => [starts[from] ?? text.length, ends[to - 1] ?? text.length],
  };
};

export type Span = { token: string; start: number; end: number };

export const spans = (folded: string): Span[] =>
  [...folded.matchAll(SEARCH_WORD)].map((match) => ({
    token: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

export const tokens = (text: string): string[] => spans(fold(text)).map(({ token }) => token);

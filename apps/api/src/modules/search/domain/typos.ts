import { spend, type WorkBudget, workBudget } from './workBudget';

export const osaWithin = (
  a: string,
  whole: string,
  budget: number,
  { prefix = false }: { prefix?: boolean } = {},
): { distance: number | undefined; cells: number } => {
  const b = prefix ? whole.slice(0, a.length + budget) : whole;
  if (!prefix && Math.abs(a.length - b.length) > budget) return { distance: undefined, cells: 0 };
  if (b.length < a.length - budget) return { distance: undefined, cells: 0 };
  const over = budget + 1;
  const at = (row: number[], j: number): number => row[j] ?? over;

  let twoAgo: number[] = [];
  let previous: number[] = Array.from({ length: Math.min(b.length, budget) + 1 }, (_, j) => j);
  let cells = 0;
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [];
    if (i <= budget) current[0] = i;
    let rowMin = at(current, 0);
    for (let j = Math.max(1, i - budget); j <= Math.min(b.length, i + budget); j += 1) {
      cells += 1;
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      const edit = Math.min(
        at(previous, j) + 1,
        at(current, j - 1) + 1,
        at(previous, j - 1) + substitution,
      );
      const swapped = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      const value = Math.min(over, swapped ? Math.min(edit, at(twoAgo, j - 2) + 1) : edit);
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > budget) return { distance: undefined, cells };
    twoAgo = previous;
    previous = current;
  }

  const distance = prefix ? Math.min(...Object.values(previous)) : at(previous, b.length);
  return { distance: distance <= budget ? distance : undefined, cells };
};

export const maxTypos = (word: string): number => (word.length < 3 ? 0 : word.length < 6 ? 1 : 2);

/**
 * Sound-alike rules, English and French, applied in order to both words: y as i, doubled
 * letters as one, ph as f, qu as k (the earlier engine's table). Each rule has a test that it finds what it
 * should and nothing more; rules like c → k or c → s are left out because they would make every
 * "c" word sound like a "k" or "s" word.
 */
const SOUND_RULES: [RegExp, string][] = [
  [/y/g, 'i'],
  [/(.)\1+/gu, '$1'],
  [/ph/g, 'f'],
  [/qu/g, 'k'],
];

const sound = (word: string): string =>
  SOUND_RULES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), word);

export const soundsLike = (typed: string, word: string): boolean =>
  typed.length >= 3 && sound(word.slice(0, 4 * typed.length)).startsWith(sound(typed));

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const MAX_CANDIDATES = 5;
export const MAX_FUZZY_LENGTH = 32;

export type Correction = {
  word: string;
  typos: number;

  soundAlike: boolean;

  startOnly: boolean;
};

type Candidate = Correction & { frequency: number };

const order = (x: Candidate, y: Candidate): number =>
  x.typos - y.typos ||
  Number(x.soundAlike) - Number(y.soundAlike) ||
  Number(x.startOnly) - Number(y.startOnly) ||
  y.frequency - x.frequency ||
  compare(x.word, y.word);

const keepBest = (best: Candidate[], next: Candidate): Candidate[] => {
  const at = best.findIndex((kept) => order(next, kept) < 0);
  const merged = at === -1 ? [...best, next] : [...best.slice(0, at), next, ...best.slice(at)];
  return merged.slice(0, MAX_CANDIDATES);
};

const HAS_DIGIT = /\p{N}/u;

const CACHE_LIMIT = 4096;

export const corrections = (
  word: string,
  vocabulary: Iterable<[string, number]>,
  work: WorkBudget = workBudget(),
): Correction[] => {
  const typos = maxTypos(word);
  if (typos === 0 || word.length > MAX_FUZZY_LENGTH || !spend(work, 1)) return [];
  const band = (2 * typos + 1) * (word.length + 1);
  const startDistances = new Map<string, number | undefined>();
  let best: Candidate[] = [];
  for (const [candidate, frequency] of vocabulary) {
    if (!spend(work, 1)) break;

    if (HAS_DIGIT.test(candidate)) continue;
    const start = candidate.slice(0, word.length + typos);
    let distance = startDistances.get(start);
    if (!startDistances.has(start)) {
      if (!spend(work, band)) break;
      distance = osaWithin(word, start, typos, { prefix: true }).distance;
      if (startDistances.size < CACHE_LIMIT) startDistances.set(start, distance);
    }
    if (distance !== undefined) {
      const lengthClose = Math.abs(candidate.length - word.length) <= distance;
      if (lengthClose && !spend(work, band)) break;
      const whole = lengthClose ? osaWithin(word, candidate, typos).distance : undefined;
      const startOnly = whole !== distance;
      best = keepBest(best, {
        word: candidate,
        frequency,
        typos: distance,
        soundAlike: false,
        startOnly,
      });
      continue;
    }
    if (!spend(work, 4 * word.length)) break;
    if (soundsLike(word, candidate)) {
      best = keepBest(best, {
        word: candidate,
        frequency,
        typos: typos + 1,
        soundAlike: true,
        startOnly: false,
      });
    }
  }

  const [top] = best;
  return best
    .filter(
      (candidate) =>
        top !== undefined &&
        candidate.typos === top.typos &&
        candidate.soundAlike === top.soundAlike &&
        candidate.startOnly === top.startOnly,
    )
    .map(({ word: known, typos: distance, soundAlike, startOnly }) => ({
      word: known,
      typos: distance,
      soundAlike,
      startOnly,
    }));
};

export const closeWords = (
  word: string,
  vocabulary: Iterable<[string, number]>,
  work: WorkBudget = workBudget(),
): string[] => corrections(word, vocabulary, work).map(({ word: known }) => known);

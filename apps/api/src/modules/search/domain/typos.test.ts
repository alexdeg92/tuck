import { describe, expect, it } from 'vitest';
import {
  closeWords,
  MAX_CANDIDATES,
  MAX_FUZZY_LENGTH,
  maxTypos,
  osaWithin,
  soundsLike,
} from './typos';
import { spend, workBudget } from './workBudget';

/** The textbook full-matrix OSA distance, as the reference the banded version must agree with. */
const osaDistance = (a: string, b: string): number => {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => d[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      const swapped = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      const row = d[i];
      if (row !== undefined) row[j] = swapped ? Math.min(best, at(i - 2, j - 2) + 1) : best;
    }
  }
  return at(a.length, b.length);
};

describe('osaWithin with a generous budget (optimal string alignment)', () => {
  it.each([
    ['milk', 'milk', 0],
    ['mlik', 'milk', 1], // adjacent transposition counts as one typo
    ['grocries', 'groceries', 1], // deletion
    ['recieve', 'receive', 1],
    ['milk', 'silk', 1], // substitution
    ['ca', 'abc', 3], // OSA, not full Damerau: no edits of an already transposed pair
  ])('%s -> %s = %d', (a, b, distance) => {
    expect(osaWithin(a, b, 5).distance).toBe(distance);
  });
});

describe('osaWithin (banded, stops at the budget)', () => {
  const pairs: [string, string][] = [
    ['milk', 'milk'],
    ['mlik', 'milk'],
    ['grocries', 'groceries'],
    ['recieve', 'receive'],
    ['milk', 'silk'],
    ['ca', 'abc'],
    ['kitten', 'sitting'],
    ['abcdef', 'badcfe'],
    ['', 'ab'],
  ];

  it.each([1, 2])('agrees with the full distance whenever it is within budget %d', (budget) => {
    pairs.forEach(([a, b]) => {
      const full = osaDistance(a, b);
      expect(osaWithin(a, b, budget).distance, `${a}/${b}`).toBe(full <= budget ? full : undefined);
    });
  });

  it('computes only a band of 2k+1 cells per row', () => {
    const a = 'x'.repeat(200);
    const { cells } = osaWithin(a, `${'x'.repeat(199)}y`, 2);
    expect(cells).toBeLessThanOrEqual(5 * 200);
  });

  it('stops as soon as a whole row is over budget', () => {
    const { distance, cells } = osaWithin('a'.repeat(200), 'b'.repeat(200), 2);
    expect(distance).toBeUndefined();
    expect(cells).toBeLessThanOrEqual(5 * 3);
  });
});

/** Every string over {a, b} up to four letters, empty included: small, but every shape. */
const ALL_AB = [''].concat(
  ...[1, 2, 3, 4].map((size) =>
    Array.from({ length: 2 ** size }, (_, n) =>
      Array.from({ length: size }, (_, bit) => ((n >> bit) & 1 ? 'b' : 'a')).join(''),
    ),
  ),
);

describe('osaWithin agrees with the reference on every pair (ported from an earlier search engine)', () => {
  it.each([1, 2])('whole words, budget %d', (budget) => {
    ALL_AB.forEach((a) => {
      ALL_AB.forEach((b) => {
        const full = osaDistance(a, b);
        expect(osaWithin(a, b, budget).distance, `${a}/${b}`).toBe(
          full <= budget ? full : undefined,
        );
      });
    });
  });

  it.each([1, 2])('against the start of a word, budget %d', (budget) => {
    ALL_AB.forEach((a) => {
      ALL_AB.forEach((b) => {
        const best = Math.min(
          ...Array.from({ length: b.length + 1 }, (_, end) => osaDistance(a, b.slice(0, end))),
        );
        expect(osaWithin(a, b, budget, { prefix: true }).distance, `${a}/${b}`).toBe(
          best <= budget ? best : undefined,
        );
      });
    });
  });

  it('reads only the start of a long word', () => {
    const { distance, cells } = osaWithin('drwe', `drawer${'x'.repeat(5000)}`, 1, { prefix: true });
    expect(distance).toBe(1);
    expect(cells).toBeLessThanOrEqual(3 * 4);
  });
});

describe('maxTypos', () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 1],
    [5, 1],
    [6, 2],
    [12, 2],
  ])('a %d-letter word allows %d typos', (length, typos) => {
    expect(maxTypos('x'.repeat(length))).toBe(typos);
  });
});

/** A distinct letters-only suffix for n (digit tokens are never corrections). */
const letters = (n: number): string =>
  Array.from({ length: 4 }, (_, place) =>
    'abcdefghijklmnopqrstuvwxyz'.charAt(Math.floor(n / 26 ** place) % 26),
  ).join('');

describe('closeWords', () => {
  const vocabulary = new Map([
    ['groceries', 3],
    ['bear', 2],
    ['beer', 1],
    ['milk', 5],
    ['cat', 4],
  ]);

  it('finds words within the typo budget, closest then most frequent then alphabetical', () => {
    expect(closeWords('grocries', vocabulary)).toEqual(['groceries']);
    expect(closeWords('baer', vocabulary)).toEqual(['bear', 'beer']);
  });

  it('does not fuzz words under three letters, and fuzzes three-letter words by one typo', () => {
    expect(closeWords('ct', vocabulary)).toEqual([]);
    expect(closeWords('cta', vocabulary)).toEqual(['cat']);
  });

  it('matches a half-typed word against the start of each known word', () => {
    const known = new Map([
      ['drawer', 3],
      ['drawing', 1],
      ['tremblay', 1],
    ]);
    expect(closeWords('drwe', known)).toEqual(['drawer']);
    expect(closeWords('trembl', known)).toEqual(['tremblay']);
  });

  it('prefers a whole-word match to a word that only starts close, and keeps only that tier', () => {
    const known = new Map([
      ['bank', 9],
      ['ian', 1],
    ]);
    expect(closeWords('yan', known)).toEqual(['ian']);
    expect(closeWords('yan', new Map([['bank', 9]]))).toEqual(['bank']);
  });

  it('falls back to sound-alikes only when no real typo match exists', () => {
    const known = new Map([
      ['filipe', 1],
      ['phone', 1],
      ['fond', 1],
    ]);
    expect(closeWords('phillippe', known)).toEqual(['filipe']);
    expect(closeWords('fone', known)).toEqual(['fond']);
    expect(closeWords('fone', new Map([['phone', 1]]))).toEqual(['phone']);
  });

  it('computes one distance per word start, however many words share it', () => {
    const known = new Map(Array.from({ length: 1000 }, (_, n) => [`budgeting${letters(n)}`, 1]));
    const budget = workBudget();

    expect(closeWords('budgte', known, budget)).toHaveLength(MAX_CANDIDATES);
    // 1 unit per word read plus one banded distance, not a thousand of them.
    expect(budget.spent).toBeLessThan(1000 + 10 * 50);
  });

  it('keeps only the best few candidates however many words are close', () => {
    const query = 'aaaaaaaa';
    const nearby = new Map<string, number>();
    for (let x = 0; x < 8; x += 1) {
      for (let y = x + 1; y < 8; y += 1) {
        for (const a of 'bcdefghijklm') {
          for (const b of 'bcdefghijklm') {
            const word = Array.from(query);
            word[x] = a;
            word[y] = b;
            nearby.set(word.join(''), 1);
          }
        }
      }
    }

    expect(nearby.size).toBeGreaterThan(4000);
    expect(closeWords(query, nearby)).toHaveLength(MAX_CANDIDATES);
    nearby.set('aaaaaaab', 1); // one typo away: a better tier, the only one kept
    expect(closeWords(query, nearby)).toEqual(['aaaaaaab']);
  });

  it(`does not fuzz words longer than ${String(MAX_FUZZY_LENGTH)} letters`, () => {
    const long = 'x'.repeat(MAX_FUZZY_LENGTH + 1);
    expect(closeWords(long, new Map([[`${long.slice(0, -1)}y`, 1]]))).toEqual([]);
  });

  /** A vocabulary that counts how many entries the caller actually reads. */
  const counting = (size: number) => {
    const read = { count: 0 };
    const entries = function* (): Generator<[string, number]> {
      for (let index = 0; index < size; index += 1) {
        read.count += 1;
        yield [`word${letters(index)}`, 1];
      }
    };
    return { read, entries };
  };

  it('reads no vocabulary at all once the budget is spent', () => {
    const { read, entries } = counting(100_000);
    const budget = workBudget(10);
    spend(budget, 10);

    expect(closeWords('wordzzzz', entries(), budget)).toEqual([]);
    expect(read.count).toBe(0);
  });

  it('stops reading the vocabulary at the first reservation that fails', () => {
    const { read, entries } = counting(100_000);
    const budget = workBudget(1_000);

    closeWords('wordzzzz', entries(), budget);

    expect(budget.exhausted).toBe(true);
    expect(read.count).toBeLessThan(1_000);
  });

  it('finds nothing when every word is too far', () => {
    expect(closeWords('zzzzzz', vocabulary)).toEqual([]);
  });
});

describe('soundsLike (English and French sound-alikes)', () => {
  it.each([
    ['philip', 'filippe'], // ph -> f, doubled letters
    ['quentin', 'kentin'], // qu -> k
    ['yan', 'ian'], // y -> i
    ['fone', 'phone'],
  ])('%s sounds like the start of %s', (typed, word) => {
    expect(soundsLike(typed, word)).toBe(true);
  });

  it.each([
    ['fone', 'fan'],
    ['kat', 'cat'], // no c -> k rule: it would make every "c" word a "k" word
    ['ph', 'f'], // under three letters: never
  ])('%s does not sound like %s', (typed, word) => {
    expect(soundsLike(typed, word)).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fromPlainText,
  HIGHLIGHT_COLORS,
  isSafeHref,
  NOTE_JSON_MAX,
  NOTE_NODES_MAX,
  NOTE_TABLE_COLUMNS_MAX,
  NOTE_TABLE_ROWS_MAX,
  NOTE_TEXT_MAX,
  NoteDoc,
  NoteDocShape,
  projectNote,
} from './noteDoc';

const example = (): unknown =>
  JSON.parse(readFileSync(new URL('../examples/note-doc.json', import.meta.url), 'utf8'));

const text = (value: string, ...marks: unknown[]) =>
  marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks };
const p = (value?: string) =>
  value === undefined ? { type: 'paragraph' } : { type: 'paragraph', content: [text(value)] };
const item = (...content: unknown[]) => ({ type: 'listItem', content });
const bullets = (...items: unknown[]) => ({ type: 'bulletList', content: items });
const cell = (value: string, kind = 'tableCell') => ({ type: kind, content: [p(value)] });
const row = (...cells: unknown[]) => ({ type: 'tableRow', content: cells });
const table = (...rows: unknown[]) => ({ type: 'table', content: rows });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const marked = (...marks: unknown[]) => doc({ type: 'paragraph', content: [text('x', ...marks)] });

describe('NoteDoc: what a note may contain ', () => {
  it("accepts the editor's JSON for every allowed node and mark", () => {
    expect(NoteDoc.safeParse(example()).success).toBe(true);
  });

  it('drops the presentational attrs the editor adds, keeping only what the note means', () => {
    const json = JSON.stringify(NoteDoc.parse(example()));
    expect(json).not.toMatch(
      /target|noopener|"class"|"title"|"type":null|colspan|colwidth|language/,
    );
    expect(json).toContain('{"href":"https://example.com"}');
    expect(json).toContain('"attrs":{"start":1}');
    expect(json).toContain('{"type":"highlight","attrs":{"color":"yellow"}}');
    expect(json).toContain('{"type":"textSize","attrs":{"size":"large"}}');
    expect(json).toContain('{"type":"font","attrs":{"family":"serif"}}');
  });

  it.each([
    [
      'a fourth list level',
      doc(
        bullets(item(p('1'), bullets(item(p('2'), bullets(item(p('3'), bullets(item(p('4'))))))))),
      ),
    ],
    ['an image', doc({ type: 'image', attrs: { src: 'https://example.com/a.png' } })],
    ['a checkbox list', doc({ type: 'taskList', content: [] })],
    ['a heading level 4', doc({ type: 'heading', attrs: { level: 4 }, content: [text('x')] })],
    ['an unknown mark', marked({ type: 'subscript' })],
    ['an unknown node field', doc({ ...p('x'), style: 'color:red' })],
    [
      'an unknown heading attr',
      doc({ type: 'heading', attrs: { level: 1, id: 'x' }, content: [text('x')] }),
    ],
    ['an empty text node', doc({ type: 'paragraph', content: [text('')] })],
    ['no blocks at all', doc()],
    ['an empty list', doc(bullets())],
    [
      'a quote inside a quote',
      doc({ type: 'blockquote', content: [{ type: 'blockquote', content: [p('x')] }] }),
    ],
    ['a table inside a quote', doc({ type: 'blockquote', content: [table(row(cell('a')))] })],
    ['a code block with marks', doc({ type: 'codeBlock', content: [text('x', { type: 'bold' })] })],
    [
      'a code block with a language',
      doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [text('x')] }),
    ],
    [
      'a list inside a table cell',
      doc(table(row({ type: 'tableCell', content: [bullets(item(p('x')))] }))),
    ],
    ['a merged table cell', doc(table(row({ ...cell('a'), attrs: { colspan: 2, rowspan: 1 } })))],
    ['rows of different lengths', doc(table(row(cell('a'), cell('b')), row(cell('c'))))],
    [
      `more than ${String(NOTE_TABLE_ROWS_MAX)} rows`,
      doc(table(...Array.from({ length: NOTE_TABLE_ROWS_MAX + 1 }, () => row(cell('a'))))),
    ],
    [
      `more than ${String(NOTE_TABLE_COLUMNS_MAX)} columns`,
      doc(table(row(...Array.from({ length: NOTE_TABLE_COLUMNS_MAX + 1 }, () => cell('a'))))),
    ],
    [
      'a highlight colour outside the palette',
      marked({ type: 'highlight', attrs: { color: 'red' } }),
    ],
    ['a highlight as a CSS colour', marked({ type: 'highlight', attrs: { color: '#ff0000' } })],
    ['a size as a CSS value', marked({ type: 'textSize', attrs: { size: '13px' } })],
    ['the default size as a mark', marked({ type: 'textSize', attrs: { size: 'normal' } })],
    ['a font outside the list', marked({ type: 'font', attrs: { family: 'Comic Sans MS' } })],
    ['the default font as a mark', marked({ type: 'font', attrs: { family: 'sans' } })],
    ['a text colour (textStyle)', marked({ type: 'textStyle', attrs: { color: 'red' } })],
    [
      'an unknown highlight attr',
      marked({ type: 'highlight', attrs: { color: 'yellow', style: 'x' } }),
    ],
  ])('refuses %s', (_label, value) => {
    expect(NoteDoc.safeParse(value).success).toBe(false);
  });

  it('accepts three list levels, every heading level 1 to 3, and every palette colour', () => {
    const three = doc(bullets(item(p('1'), bullets(item(p('2'), bullets(item(p('3'))))))));
    expect(NoteDoc.safeParse(three).success).toBe(true);
    [1, 2, 3].forEach((level) => {
      expect(
        NoteDoc.safeParse(doc({ type: 'heading', attrs: { level }, content: [text('x')] })).success,
      ).toBe(true);
    });
    HIGHLIGHT_COLORS.forEach((color) => {
      expect(NoteDoc.safeParse(marked({ type: 'highlight', attrs: { color } })).success).toBe(true);
    });
  });

  it(`accepts a full ${String(NOTE_TABLE_ROWS_MAX)} × ${String(NOTE_TABLE_COLUMNS_MAX)} table`, () => {
    const full = doc(
      table(
        ...Array.from({ length: NOTE_TABLE_ROWS_MAX }, () =>
          row(...Array.from({ length: NOTE_TABLE_COLUMNS_MAX }, () => cell('a'))),
        ),
      ),
    );
    expect(NoteDoc.safeParse(full).success).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '/relative/path',
    'ftp://example.com/file',
  ])('refuses the link %s', (href) => {
    expect(NoteDoc.safeParse(marked({ type: 'link', attrs: { href } })).success).toBe(false);
    expect(isSafeHref(href)).toBe(false);
  });

  it.each(['https://example.com/a?b=c', 'http://example.com', 'mailto:someone@example.com'])(
    'allows the link %s',
    (href) => {
      expect(isSafeHref(href)).toBe(true);
    },
  );

  it(`refuses more than ${String(NOTE_TEXT_MAX)} characters of text, with a message`, () => {
    const result = NoteDoc.safeParse(doc(p('x'.repeat(NOTE_TEXT_MAX + 1))));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Notes are limited to 20000 characters');
    expect(NoteDoc.safeParse(doc(p('x'.repeat(NOTE_TEXT_MAX)))).success).toBe(true);
  });

  it(`refuses more than ${String(NOTE_NODES_MAX)} nodes or ${String(NOTE_JSON_MAX)} bytes of JSON`, () => {
    const many = doc(...Array.from({ length: NOTE_NODES_MAX }, () => p('a')));
    expect(NoteDoc.safeParse(many).success).toBe(false);
    const linkMark = { type: 'link', attrs: { href: `https://example.com/${'x'.repeat(2000)}` } };
    const heavy = doc(
      ...Array.from({ length: Math.ceil(NOTE_JSON_MAX / 2000) + 1 }, () => ({
        type: 'paragraph',
        content: [text('ab', linkMark)],
      })),
    );
    expect(JSON.stringify(heavy).length).toBeGreaterThan(NOTE_JSON_MAX);
    expect(NoteDoc.safeParse(heavy).success).toBe(false);
  });

  it('reads any stored note whatever its size (the caps are for what a client sends)', () => {
    const legacy = fromPlainText('\n'.repeat(NOTE_TEXT_MAX - 1));
    expect(NoteDoc.safeParse(legacy).success).toBe(false);
    expect(NoteDocShape.safeParse(legacy).success).toBe(true);
  });
});

describe('projectNote: the plain text search and highlights use', () => {
  it('joins text blocks with a newline, cells with a tab; no markers, rules add nothing', () => {
    expect(projectNote(NoteDoc.parse(example())).text).toBe(
      [
        'Budget plan',
        'Café budget 😀 review\nline two',
        'old and big serif\tindented link',
        'Lists',
        'first budget',
        'nested budget',
        'third level',
        'quoted budget',
        'x = budget\ny = 2',
        'Costs',
        'Item\tBudget',
        'Train\t210',
        '',
      ].join('\n'),
    );
  });

  it('maps text offsets to editor positions (ProseMirror arithmetic)', () => {
    expect(projectNote(NoteDoc.parse(doc(p('ab')))).toPos(0)).toBe(1);
    expect(projectNote(NoteDoc.parse(doc(p('ab'), p('cd')))).toPos(3)).toBe(5);
    expect(projectNote(NoteDoc.parse(doc(bullets(item(p('x')))))).toPos(0)).toBe(3);
    const nested = projectNote(NoteDoc.parse(doc(bullets(item(p('a'), bullets(item(p('b'))))))));
    expect(nested.text).toBe('a\nb');
    expect(nested.toPos(2)).toBe(8);
    expect(nested.toPos(1, { end: true })).toBe(4);
    const ruled = projectNote(NoteDoc.parse(doc(p('a'), { type: 'horizontalRule' }, p('b'))));
    expect(ruled.text).toBe('a\nb');
    expect(ruled.toPos(2)).toBe(5);
  });

  it('maps a table row by row: the tab between cells has no position', () => {
    const grid = projectNote(NoteDoc.parse(doc(table(row(cell('a'), cell('b'))))));
    expect(grid.text).toBe('a\tb');
    expect(grid.toPos(0)).toBe(4);
    expect(grid.toPos(2)).toBe(9);
    expect(grid.toPos(1)).toBe(9);
    expect(grid.toPos(1, { end: true })).toBe(5);
  });

  it('starts a range that begins on a block separator at the next block', () => {
    const two = projectNote(NoteDoc.parse(doc(p('ab'), p('cd'))));
    expect(two.toPos(2)).toBe(5);
    expect(two.toPos(2, { end: true })).toBe(3);
  });

  it('gives every character of every generated doc the position a separate walk finds', () => {
    const random = seeded(7);
    for (let round = 0; round < 300; round += 1) {
      const value = NoteDoc.parse(randomDoc(random));
      const { text: projected, segments, toPos } = projectNote(value);
      const reference = referencePositions(value);

      expect(reference.length).toBe(projected.length - Math.max(0, segments.length - 1));
      reference.forEach(({ offset, pos }) => {
        expect(toPos(offset), `round ${String(round)} offset ${String(offset)}`).toBe(pos);
      });
    }
  });
});

describe('fromPlainText: how an old plain note reads', () => {
  it('makes each line a paragraph and keeps the text exactly', () => {
    expect(fromPlainText('a\n\nb')).toEqual(doc(p('a'), p(), p('b')));
    expect(fromPlainText('')).toEqual(doc(p()));
    expect(fromPlainText('- milk')).toEqual(doc(p('- milk')));
  });

  it('projects back to the same text for any old note (windows newlines become \\n)', () => {
    const random = seeded(11);
    const pieces = ['a', 'Café', '😀', ' ', '\t', '\n', '\r\n', '\r', '\n\n', 'budget', 'é'];
    for (let round = 0; round < 300; round += 1) {
      const value = Array.from(
        { length: random(60) },
        () => pieces[random(pieces.length - 1)],
      ).join('');
      expect(projectNote(fromPlainText(value)).text).toBe(
        value.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
      );
      expect(NoteDocShape.safeParse(fromPlainText(value)).success).toBe(true);
    }
    const longest = 'x'.repeat(NOTE_TEXT_MAX);
    expect(projectNote(fromPlainText(longest)).text).toBe(longest);
  });
});

function seeded(seed: number): (max: number) => number {
  let state = seed;
  return (max) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max + 1));
  };
}

const MARKS: unknown[] = [
  { type: 'bold' },
  { type: 'underline' },
  { type: 'strike' },
  { type: 'highlight', attrs: { color: 'green' } },
  { type: 'font', attrs: { family: 'mono' } },
  { type: 'textSize', attrs: { size: 'xlarge' } },
];

function randomInline(random: (max: number) => number): unknown[] {
  const words = ['ab', 'Café', '😀', 'x y', 'budget', 'a\tb'];
  return Array.from({ length: random(3) }, () =>
    random(4) === 0
      ? { type: 'hardBreak' }
      : random(1)
        ? text(words[random(words.length - 1)] ?? 'a', MARKS[random(MARKS.length - 1)])
        : text(words[random(words.length - 1)] ?? 'a'),
  );
}

function randomDoc(random: (max: number) => number): unknown {
  const para = () => {
    const content = randomInline(random);
    return content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content };
  };
  const list = (depth: number): unknown => ({
    type: random(1) ? 'bulletList' : 'orderedList',
    content: Array.from({ length: 1 + random(2) }, () =>
      depth < 2 && random(1) ? item(para(), list(depth + 1)) : item(para()),
    ),
  });
  const grid = () => {
    const columns = 1 + random(2);
    return table(
      ...Array.from({ length: 1 + random(2) }, (_, r) =>
        row(
          ...Array.from({ length: columns }, () => ({
            type: r === 0 ? 'tableHeader' : 'tableCell',
            content: Array.from({ length: 1 + random(1) }, para),
          })),
        ),
      ),
    );
  };
  const blocks = [
    para,
    () => ({ ...para(), type: 'heading', attrs: { level: 1 + random(2) } }),
    () => list(0),
    () => ({ type: 'blockquote', content: [para(), list(1)] }),
    () => ({ type: 'codeBlock', content: [text('x = 1\n  y')] }),
    () => ({ type: 'horizontalRule' }),
    grid,
  ];
  return doc(
    ...Array.from({ length: 1 + random(4) }, () => (blocks[random(blocks.length - 1)] ?? para)()),
  );
}

type AnyNode = { type: string; text?: string; content?: AnyNode[] };
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

function referencePositions(value: NoteDoc): { offset: number; pos: number }[] {
  const out: { offset: number; pos: number }[] = [];
  let offset = 0;
  let firstBlock = true;
  const walk = (node: AnyNode, pos: number): number => {
    if (node.type === 'text') {
      const value = node.text ?? '';
      for (let i = 0; i < value.length; i += 1) out.push({ offset: offset + i, pos: pos + i });
      offset += value.length;
      return pos + value.length;
    }
    if (node.type === 'hardBreak') {
      out.push({ offset, pos });
      offset += 1;
      return pos + 1;
    }
    if (node.type === 'horizontalRule') return pos + 1;
    if (TEXT_BLOCKS.has(node.type)) {
      if (!firstBlock) offset += 1;
      firstBlock = false;
    }
    let inner = pos + 1;
    for (const child of node.content ?? []) inner = walk(child, inner);
    return inner + 1;
  };
  let pos = 0;
  for (const block of value.content as AnyNode[]) pos = walk(block, pos);
  return out;
}

describe('the size limits (a long document with tables, not a page)', () => {
  it('are 20 000 characters, 512 KB of JSON and 20 000 nodes, and match plain notes', () => {
    expect([NOTE_TEXT_MAX, NOTE_JSON_MAX, NOTE_NODES_MAX]).toEqual([20_000, 512 * 1024, 20_000]);
  });
});

describe("the editor's own JSON (fixtures, one per node and mark)", () => {
  const fixtures = JSON.parse(
    readFileSync(new URL('../fixtures/editor-note-docs.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

  it('covers every node and mark', () => {
    expect(Object.keys(fixtures).length).toBeGreaterThanOrEqual(24);
  });

  it.each(Object.entries(fixtures))('parses %s as a note a client may send', (_name, value) => {
    expect(NoteDoc.safeParse(value).success).toBe(true);
  });
});

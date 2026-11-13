import { type NoteDoc, NoteDoc as NoteDocSchema, projectNote } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { normaliseNote } from './normalise';

const text = (value: string, marks?: string[]) =>
  marks === undefined
    ? { type: 'text' as const, text: value }
    : { type: 'text' as const, text: value, marks: marks.map((type) => ({ type })) };
const doc = (...content: unknown[]): NoteDoc => NoteDocSchema.parse({ type: 'doc', content });
const p = (...content: unknown[]) =>
  content.length === 0 ? { type: 'paragraph' } : { type: 'paragraph', content };

describe('normaliseNote: one stored form for what looks the same', () => {
  it('merges neighbouring texts with the same marks', () => {
    expect(normaliseNote(doc(p(text('Ca'), text('fé'), text('!', ['bold']))))).toEqual(
      doc(p(text('Café'), text('!', ['bold']))),
    );
  });

  it('orders marks bold, italic, code, link, and keeps one of each', () => {
    const link = { type: 'link', attrs: { href: 'https://example.com' } };
    const messy = doc(
      p({
        type: 'text',
        text: 'x',
        marks: [link, { type: 'code' }, { type: 'bold' }, { type: 'bold' }],
      }),
    );
    expect(normaliseNote(messy)).toEqual(
      doc(p({ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'code' }, link] })),
    );
  });

  it('merges texts whose marks differ only in order', () => {
    expect(
      normaliseNote(doc(p(text('a', ['italic', 'bold']), text('b', ['bold', 'italic'])))),
    ).toEqual(doc(p(text('ab', ['bold', 'italic']))));
  });

  it('drops trailing empty paragraphs, keeping one block', () => {
    expect(normaliseNote(doc(p(text('a')), p(), p()))).toEqual(doc(p(text('a'))));
    expect(normaliseNote(doc(p(), p(), p()))).toEqual(doc(p()));
    expect(normaliseNote(doc(p(), p(text('a'))))).toEqual(doc(p(), p(text('a'))));
  });

  it('writes an empty block without a content array', () => {
    expect(
      normaliseNote(
        NoteDocSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [] }] }),
      ),
    ).toEqual(doc(p()));
  });

  it('is idempotent and never changes the text inside blocks', () => {
    const notes = [
      doc(p(text('a'), text('b'), { type: 'hardBreak' }, text('c', ['code'])), p(), p()),
      doc(
        { type: 'heading', attrs: { level: 3 }, content: [text('t'), text('itle')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('x'), text('y'))] }] },
      ),
    ];
    notes.forEach((note) => {
      const once = normaliseNote(note);
      expect(normaliseNote(once)).toEqual(once);
      expect(projectNote(once).text).toBe(projectNote(note).text.replace(/\n+$/, ''));
    });
  });

  it('orders every mark: bold, italic, underline, strike, code, link, highlight, size, font', () => {
    const all = [
      { type: 'font', attrs: { family: 'serif' } },
      { type: 'textSize', attrs: { size: 'large' } },
      { type: 'highlight', attrs: { color: 'pink' } },
      { type: 'link', attrs: { href: 'https://example.com' } },
      { type: 'code' },
      { type: 'strike' },
      { type: 'underline' },
      { type: 'italic' },
      { type: 'bold' },
    ];
    expect(normaliseNote(doc(p({ type: 'text', text: 'x', marks: all })))).toEqual(
      doc(p({ type: 'text', text: 'x', marks: [...all].reverse() })),
    );
  });

  it('normalises inside quotes, three-level lists, tables and code blocks', () => {
    const cellOf = (...content: unknown[]) => ({ type: 'tableCell', content: [p(...content)] });
    const before = doc(
      { type: 'blockquote', content: [p(text('a'), text('b'))] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              p(text('1')),
              {
                type: 'orderedList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      p(text('2')),
                      {
                        type: 'bulletList',
                        content: [{ type: 'listItem', content: [p(text('3'), text('!'))] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { type: 'table', content: [{ type: 'tableRow', content: [cellOf(text('c'), text('d'))] }] },
      { type: 'codeBlock', content: [text('x'), text('y')] },
    );
    const after = normaliseNote(before);
    const json = JSON.stringify(after);
    expect(json).toContain('"text":"ab"');
    expect(json).toContain('"text":"3!"');
    expect(json).toContain('"text":"cd"');
    expect(json).toContain('"text":"xy"');
    expect(normaliseNote(after)).toEqual(after);
    expect(projectNote(after).text).toBe(projectNote(before).text);
  });
});

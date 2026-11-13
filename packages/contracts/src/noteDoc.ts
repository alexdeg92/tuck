import { z } from 'zod';

export const NOTE_TEXT_MAX = 20_000;

export const NOTE_JSON_MAX = 512 * 1024;

export const NOTE_NODES_MAX = 20_000;
export const NOTE_TABLE_ROWS_MAX = 20;
export const NOTE_TABLE_COLUMNS_MAX = 10;

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'] as const;

export const TEXT_SIZES = ['small', 'large', 'xlarge'] as const;

export const FONT_FAMILIES = ['serif', 'mono'] as const;

const NoteHref = z.url({ protocol: /^(https?|mailto)$/ }).max(2048);

export const isSafeHref = (href: string): boolean => NoteHref.safeParse(href).success;

const Presentational = z.string().nullable().optional();

const Mark = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('underline') }),
  z.strictObject({ type: z.literal('strike') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z
      .strictObject({
        href: NoteHref,
        target: Presentational,
        rel: Presentational,
        class: Presentational,
        title: Presentational,
      })
      .transform(({ href }) => ({ href })),
  }),
  z.strictObject({
    type: z.literal('highlight'),
    attrs: z.strictObject({ color: z.enum(HIGHLIGHT_COLORS) }),
  }),
  z.strictObject({
    type: z.literal('textSize'),
    attrs: z.strictObject({ size: z.enum(TEXT_SIZES) }),
  }),
  z.strictObject({
    type: z.literal('font'),
    attrs: z.strictObject({ family: z.enum(FONT_FAMILIES) }),
  }),
]);
export type NoteMark = z.infer<typeof Mark>;

const Text = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(Mark).max(9).optional(),
});
const HardBreak = z.strictObject({ type: z.literal('hardBreak') });
const Inline = z.discriminatedUnion('type', [Text, HardBreak]);

const Paragraph = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(Inline).optional(),
});
const Heading = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  content: z.array(Inline).optional(),
});

const CodeBlock = z
  .strictObject({
    type: z.literal('codeBlock'),
    attrs: z.strictObject({ language: z.null() }).optional(),
    content: z
      .array(z.strictObject({ type: z.literal('text'), text: z.string().min(1) }))
      .optional(),
  })
  .transform(({ type, content }) => (content === undefined ? { type } : { type, content }));
const HorizontalRule = z.strictObject({ type: z.literal('horizontalRule') });

const listOf = <T extends z.ZodType>(item: T) =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('bulletList'), content: z.array(item).min(1) }),
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z
        .strictObject({
          start: z.number().int().min(1).max(9999).default(1),
          type: z.null().optional(),
        })
        .transform(({ start }) => ({ start }))
        .optional(),
      content: z.array(item).min(1),
    }),
  ]);
const itemWith = <T extends z.ZodType>(nested: T) =>
  z.strictObject({
    type: z.literal('listItem'),
    content: z.union([z.tuple([Paragraph, nested]), z.tuple([Paragraph])]),
  });
const ThirdList = listOf(
  z.strictObject({ type: z.literal('listItem'), content: z.tuple([Paragraph]) }),
);
const SecondList = listOf(itemWith(ThirdList));
const List = listOf(itemWith(SecondList));

const Cell = z
  .strictObject({
    type: z.enum(['tableHeader', 'tableCell']),
    attrs: z
      .strictObject({
        colspan: z.literal(1).optional(),
        rowspan: z.literal(1).optional(),
        colwidth: z.array(z.number().int().min(1)).nullable().optional(),
      })
      .optional(),
    content: z.array(Paragraph).min(1),
  })
  .transform(({ type, content }) => ({ type, content }));
const Row = z.strictObject({
  type: z.literal('tableRow'),
  content: z.array(Cell).min(1).max(NOTE_TABLE_COLUMNS_MAX),
});
const Table = z
  .strictObject({
    type: z.literal('table'),
    content: z.array(Row).min(1).max(NOTE_TABLE_ROWS_MAX),
  })
  .refine(
    ({ content }) => content.every((row) => row.content.length === content[0]?.content.length),
    { message: 'Every table row must have the same number of cells' },
  );

const Blockquote = z.strictObject({
  type: z.literal('blockquote'),
  content: z.array(z.union([Paragraph, Heading, List])).min(1),
});

const Block = z.union([Paragraph, Heading, List, Blockquote, CodeBlock, HorizontalRule, Table]);

export const NoteDocShape = z.strictObject({
  type: z.literal('doc'),
  content: z.array(Block).min(1),
});
export type NoteDoc = z.infer<typeof NoteDocShape>;

export type NoteNode = {
  readonly type: string;
  readonly text?: string | undefined;
  readonly marks?: readonly NoteMark[] | undefined;
  readonly attrs?: unknown;
  readonly content?: readonly NoteNode[] | undefined;
};

export const NOTE_TEXT_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'codeBlock']);

const countNodes = (node: NoteNode): number =>
  1 + (node.content ?? []).reduce((sum, child) => sum + countNodes(child), 0);

export const NoteDoc = NoteDocShape.superRefine((doc, context) => {
  if (JSON.stringify(doc).length > NOTE_JSON_MAX) {
    context.addIssue({ code: 'custom', message: 'This note is too large to save' });
  } else if (countNodes(doc) > NOTE_NODES_MAX) {
    context.addIssue({ code: 'custom', message: 'This note has too many parts to save' });
  } else if (projectNote(doc).text.length > NOTE_TEXT_MAX) {
    context.addIssue({
      code: 'custom',
      message: `Notes are limited to ${String(NOTE_TEXT_MAX)} characters`,
    });
  }
});

export type NoteSegment = { start: number; end: number; pos: number };

export type NoteProjection = {
  text: string;
  segments: NoteSegment[];

  toPos: (offset: number, options?: { end?: boolean }) => number;
};

export const projectNote = (doc: NoteDoc): NoteProjection => {
  const segments: NoteSegment[] = [];
  let text = '';

  let separator = '\n';

  const walk = (node: NoteNode, pos: number): number => {
    if (NOTE_TEXT_BLOCKS.has(node.type)) {
      if (segments.length > 0) text += separator;
      separator = '\n';
      const own = (node.content ?? [])
        .map((inline) => (inline.type === 'text' ? (inline.text ?? '') : '\n'))
        .join('');
      segments.push({ start: text.length, end: text.length + own.length, pos: pos + 1 });
      text += own;
      return pos + own.length + 2;
    }
    if (node.content === undefined) return pos + 1;
    let inner = pos + 1;
    node.content.forEach((child, index) => {
      if (node.type === 'tableRow' && index > 0) separator = '\t';
      inner = walk(child, inner);
    });
    return inner + 1;
  };

  let pos = 0;
  for (const block of doc.content) pos = walk(block, pos);

  const toPos = (target: number, { end = false } = {}): number => {
    const index = segments.findIndex((segment) => target <= segment.end);
    const segment = segments[index] ?? segments.at(-1);
    if (segment === undefined) return 1;
    const next = segments[index + 1];
    if (!end && target === segment.end && next !== undefined && target < next.start) {
      return next.pos;
    }
    return segment.pos + Math.max(0, Math.min(target, segment.end) - segment.start);
  };
  return { text, segments, toPos };
};

export const normaliseNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

export const fromPlainText = (text: string): NoteDoc => ({
  type: 'doc',
  content: normaliseNewlines(text)
    .split('\n')
    .map((line) =>
      line === ''
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] },
    ),
});

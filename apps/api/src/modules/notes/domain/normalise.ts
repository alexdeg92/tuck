import {
  NOTE_TEXT_BLOCKS,
  normaliseNewlines,
  type NoteDoc,
  NoteDocShape,
  type NoteMark,
  type NoteNode,
} from '@todo/contracts';

const MARK_ORDER: NoteMark['type'][] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'highlight',
  'textSize',
  'font',
];

const marksOf = (marks: readonly NoteMark[] | undefined): NoteMark[] | undefined => {
  const kept = MARK_ORDER.map((type) => marks?.find((mark) => mark.type === type)).filter(
    (mark): mark is NoteMark => mark !== undefined,
  );
  return kept.length === 0 ? undefined : kept;
};

const sameMarks = (a: readonly NoteMark[] | undefined, b: readonly NoteMark[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const inlinesOf = (content: readonly NoteNode[]): NoteNode[] =>
  content.reduce<NoteNode[]>((merged, inline) => {
    if (inline.type !== 'text') return [...merged, { type: inline.type }];
    const marks = marksOf(inline.marks);
    const text = normaliseNewlines(inline.text ?? '');
    const last = merged.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, marks)) {
      return [...merged.slice(0, -1), { ...last, text: (last.text ?? '') + text }];
    }
    return [
      ...merged,
      marks === undefined ? { type: 'text', text } : { type: 'text', text, marks },
    ];
  }, []);

const nodeOf = (node: NoteNode): NoteNode => {
  const { content, ...rest } = node;
  if (NOTE_TEXT_BLOCKS.has(node.type)) {
    const inlines = inlinesOf(content ?? []);
    return inlines.length === 0 ? rest : { ...rest, content: inlines };
  }
  return content === undefined ? rest : { ...rest, content: content.map(nodeOf) };
};

const isEmptyParagraph = (block: NoteNode | undefined): boolean =>
  block?.type === 'paragraph' && block.content === undefined;

export const normaliseNote = (doc: NoteDoc): NoteDoc => {
  const blocks = doc.content.map(nodeOf);
  while (blocks.length > 1 && isEmptyParagraph(blocks.at(-1))) blocks.pop();
  return NoteDocShape.parse({ type: 'doc', content: blocks });
};

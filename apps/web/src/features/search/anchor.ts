export type FocusPlan =
  | { kind: 'reading' }
  | { kind: 'editor' }
  | { kind: 'anchor'; field: 'title' | 'notes'; offset: number; viewY: number };

const MIRRORED = [
  'box-sizing',
  'width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
  'tab-size',
  'overflow-wrap',
  'word-break',
];

export function caretTop(field: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  MIRRORED.forEach((name) => {
    mirror.style.setProperty(name, style.getPropertyValue(name));
  });
  mirror.style.setProperty('position', 'absolute');
  mirror.style.setProperty('visibility', 'hidden');
  mirror.style.setProperty('white-space', 'pre-wrap');
  mirror.textContent = field.value.slice(0, offset);
  const caret = document.createElement('span');
  caret.textContent = '​';
  mirror.append(caret);
  document.body.append(mirror);
  const top = caret.offsetTop;
  mirror.remove();
  return top;
}

export function restoreFocus(pane: HTMLElement, plan: FocusPlan, reading: HTMLElement | null) {
  if (plan.kind === 'reading') {
    reading?.focus({ preventScroll: true });
    return;
  }
  const name = plan.kind === 'anchor' ? plan.field : 'notes';
  const field = pane.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`);
  if (field === null) return;
  if (plan.kind === 'editor') {
    field.focus({ preventScroll: true });
    return;
  }
  field.setSelectionRange(plan.offset, plan.offset);
  field.focus({ preventScroll: true });

  const scroller = field.form?.parentElement;
  if (!scroller) return;
  const top =
    field.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop +
    caretTop(field, plan.offset);
  scroller.scrollTop = Math.max(0, Math.round(top - plan.viewY));

  const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 24;
  const caretInView = top - scroller.scrollTop;
  if (caretInView < PADDING || caretInView + lineHeight > scroller.clientHeight - PADDING) {
    scroller.scrollTop = Math.max(0, Math.round(top - scroller.clientHeight / 3));
  }
}

const PADDING = 24;

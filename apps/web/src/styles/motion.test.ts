import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The motion gate: every interactive control animates every state change,
 * with durations and easings from the motion tokens. Reduced motion removes movement and keeps
 * colour and opacity as short crossfades.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

type Rule = { selector: string; body: string; reduced: boolean };

/** Leaf rules of a stylesheet, flattening @media/@container/@supports blocks. */
function rules(css: string, reduced = false): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < text.length) {
      if (text[j] === '{') depth += 1;
      if (text[j] === '}') depth -= 1;
      j += 1;
    }
    const inner = text.slice(open + 1, j - 1);
    if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face')) {
      // not a selector rule
    } else if (prelude.startsWith('@')) {
      out.push(...rules(inner, reduced || prelude.includes('prefers-reduced-motion')));
    } else {
      out.push({ selector: prelude, body: inner, reduced });
    }
    i = j;
  }
  return out;
}

const files = cssFiles(src);
const tokenFiles = new Set(['system.tokens.css', 'tokens.css', 'variant.tokens.css', 'fonts.css']);
const componentFiles = files.filter((path) => !tokenFiles.has(path.split('/').pop() ?? ''));
const sheet = (path: string) => readFileSync(join(src, path), 'utf8');
const allRules = componentFiles.flatMap((path) => rules(readFileSync(path, 'utf8')));

/** A class (or attribute) token that must appear in a selector, not as a prefix of another. */
const hasToken = (selector: string, token: string) =>
  new RegExp(`${token.replace(/[.[\]()=*'"-]/g, '\\$&')}(?![\\w-])`).test(selector);

const STATES = {
  hover: /:hover|\[data-hovered/,
  press: /:active|\[data-pressed/,
  focus: /:focus-visible|:focus-within|\[data-focus-visible/,
  disabled: /:disabled|\[aria-disabled|\[data-disabled/,
} as const;
type StateName = keyof typeof STATES | 'change';

type Entry = {
  component: string;
  /** Sheets the component's rules live in (relative to src/). */
  sheets: string[];
  /** Class/attribute tokens that identify the control; a rule may use any of them. */
  tokens: string[];
  /** Selector pattern for the component's own change state (checked, open, invalid, busy…). */
  change: RegExp | { na: string };
  na?: Partial<Record<StateName, string>>;
  /** A surface (sheet, dialog, toast) moves by token-timed keyframes as well as transitions. */
  surface?: true;
};

const FLOW = 'styles/flow.css';
const RECIPES = 'styles/recipes.module.css';
const SEARCH = 'features/search/components/Search.module.css';

/** The reviewed coverage table. An N/A needs a reason a reviewer can check. */
export const MOTION_TABLE: Entry[] = [
  {
    component: 'Button (primary/secondary/ghost/danger)',
    sheets: [RECIPES, FLOW],
    tokens: ['.button', '.interactive'],
    change: /\[aria-busy|\[data-result/,
  },
  {
    component: 'Icon button (sheet/dialog close)',
    sheets: [FLOW],
    tokens: ['.plainIcon'],
    change: { na: 'stateless: it only closes its surface, whose open/close animates' },
  },
  {
    component: 'Field input (auth)',
    sheets: ['shared/ui/Field.module.css'],
    tokens: ['.control'],
    change: /\[aria-invalid|:autofill|:-webkit-autofill/,
    na: { press: 'text entry: a press places the caret; focus is the animated state' },
  },
  {
    component: 'Password Show/Hide toggle',
    sheets: ['shared/ui/Field.module.css'],
    tokens: ['.toggle'],
    change: /\[data-state/,
  },
  {
    component: 'Use demo account',
    sheets: ['features/auth/components/AuthForm.module.css'],
    tokens: ['.demo'],
    change: { na: 'its result is the Demo filled note, which fades in (AuthForm .demoDone)' },
  },
  {
    component: 'Auth links (Create an account / Sign in / Sign in instead)',
    sheets: ['features/auth/components/AuthForm.module.css'],
    tokens: ['.link'],
    change: { na: 'navigates away; no in-place state' },
    na: { disabled: 'links are never disabled' },
  },
  {
    component: 'Search field',
    sheets: [RECIPES, FLOW],
    tokens: ['.search', '.searchInput'],
    change: /:placeholder-shown|\[data-active|:has\(/,
    na: {
      press: 'text entry: a press places the caret; focus is the animated state',
      disabled: 'never disabled',
    },
  },
  {
    component: 'Search clear',
    sheets: [FLOW],
    tokens: ['.searchClear'],
    change: { na: 'clears the field; the field animates its value' },
    na: { disabled: 'only rendered when there is text to clear' },
  },
  {
    component: 'Checkbox',
    sheets: [RECIPES, FLOW],
    tokens: ['.checkbox', '.checkControl', '.checkInput'],
    change: /:checked/,
  },
  {
    component: 'Task row',
    sheets: [RECIPES, FLOW, 'features/tasks/components/TaskRow.module.css'],
    tokens: ['.taskRow', '.swipeSurface'],
    change: /\[data-selected|\[data-done|\[data-held|\[data-dragging/,
    na: { disabled: 'rows are never disabled; their controls are' },
  },
  {
    component: 'Task title link',
    sheets: [RECIPES, FLOW],
    tokens: ['.taskLink'],
    change: { na: 'the open task is shown by its row: Task row [data-selected]' },
    na: { disabled: 'links are never disabled' },
  },
  {
    component: 'Reorder grip',
    sheets: [RECIPES, FLOW],
    tokens: ['.rowGrip'],
    change: /\[data-dragging|\[aria-pressed/,
  },
  {
    component: 'Row options ⋯',
    sheets: ['features/tasks/components/TaskRow.module.css'],
    tokens: ['.rowMore'],
    change: /\[aria-expanded/,
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Completed group header',
    sheets: [FLOW],
    tokens: ['.completedSummary', '.completedGroup'],
    change: /\[open\]/,
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Task settings trigger',
    sheets: [FLOW],
    tokens: ['.taskSettingsButton'],
    change: /\[aria-expanded/,
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Settings: Open notes',
    sheets: [FLOW],
    tokens: ['.sheetOpenNotes'],
    change: { na: 'navigates to the notes; no in-place state' },
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Settings: Delete',
    sheets: [FLOW],
    tokens: ['.deleteTaskAction'],
    change: { na: 'opens the confirmation dialog, which animates' },
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Select trigger (priority)',
    sheets: ['shared/ui/Select.module.css'],
    tokens: ['.trigger'],
    change: /\[data-open\]|\[data-tone/,
  },
  {
    component: 'Select option',
    sheets: ['shared/ui/Select.module.css'],
    tokens: ['.option'],
    change: /\[data-selected\]/,
  },
  {
    component: 'Select menu',
    sheets: ['shared/ui/Select.module.css'],
    tokens: ['.popover'],
    surface: true,
    change: /\[data-entering\]|\[data-exiting\]/,
    na: {
      hover: 'a surface; its options animate',
      press: 'a surface; its options animate',
      focus: 'focus moves to the selected option, which animates its ring',
      disabled: 'a disabled select never opens',
    },
  },
  {
    component: 'Date field (segments group)',
    sheets: ['shared/ui/DatePicker.module.css'],
    tokens: ['.group'],
    change: /\[data-invalid\]|\[data-focus-within\]/,
  },
  {
    component: 'Calendar trigger, month arrows, days, Today / Clear date',
    sheets: ['shared/ui/DatePicker.module.css'],
    tokens: ['.trigger', '.nav', '.day', '.footAction'],
    change: /\[data-selected\]|\[data-today\]/,
  },
  {
    component: 'Calendar popover',
    sheets: ['shared/ui/DatePicker.module.css'],
    tokens: ['.popover'],
    surface: true,
    change: /\[data-entering\]|\[data-exiting\]/,
    na: {
      hover: 'a surface; its days and actions animate',
      press: 'a surface; its days and actions animate',
      focus: 'focus moves into the calendar grid, whose day animates its ring',
      disabled: 'a disabled picker never opens',
    },
  },
  {
    component: 'Settings sheet',
    surface: true,
    sheets: [FLOW],
    tokens: ['.settingsPopover'],
    change: /:popover-open/,
    na: {
      hover: 'a surface, not a control',
      press: 'a surface, not a control',
      focus: 'focus moves to its first control, which animates its ring',
      disabled: 'a surface, not a control',
    },
  },
  {
    component: 'Dialog',
    surface: true,
    sheets: [RECIPES, FLOW],
    tokens: ['.dialog'],
    change: /\[open\]/,
    na: {
      hover: 'a surface, not a control',
      press: 'a surface, not a control',
      focus: 'focus moves to Cancel, which animates its ring',
      disabled: 'a surface, not a control',
    },
  },
  {
    component: 'Toast',
    surface: true,
    sheets: [RECIPES],
    tokens: ['.toast'],
    change: /\[data-phase/,
    na: {
      hover: 'a surface; its Undo/Retry buttons animate',
      press: 'a surface; its Undo/Retry buttons animate',
      focus: 'a surface; its Undo/Retry buttons animate',
      disabled: 'a surface, not a control',
    },
  },
  {
    component: 'New-task draft: title',
    sheets: [FLOW],
    tokens: ['.draftTitle'],
    change: /\[aria-busy|:placeholder-shown/,
    na: { press: 'text entry: a press places the caret; focus is the animated state' },
  },
  {
    component: 'New-task draft: Create / Cancel',
    sheets: [FLOW],
    tokens: ['.draftCreate', '.draftCancel'],
    change: { na: 'they submit or close the draft, which animates' },
  },
  {
    component: 'New task (search row)',
    sheets: ['features/tasks/components/TaskList.module.css'],
    tokens: ['.newTask'],
    change: { na: 'opens the draft row, which animates' },
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Create task from search',
    sheets: [FLOW],
    tokens: ['.createSearchResult'],
    change: { na: 'opens the draft row, which animates' },
    na: { disabled: 'never disabled' },
  },
  {
    component: 'Did you mean suggestion',
    sheets: [SEARCH],
    tokens: ['.suggestion'],
    change: { na: 'applies the suggested query; the field and results update' },
  },
  {
    component: 'Search finder: previous, next, clear',
    sheets: [SEARCH],
    tokens: ['.finderButton'],
    change: { na: 'moves the current match, whose mark animates (Search mark)' },
  },
  {
    component: 'Search finder query label',
    sheets: [SEARCH],
    tokens: ['.query'],
    change: { na: 'static text; a focus stop for Enter navigation' },
    na: {
      hover: 'not a control: a focus stop for Enter navigation',
      press: 'not a control: a focus stop for Enter navigation',
      disabled: 'never disabled',
    },
  },
  {
    component: 'Search read view',
    sheets: [SEARCH],
    tokens: ['.readView'],
    change: { na: 'its marks carry the change (Search mark)' },
    na: {
      hover: 'a reading surface, not a control',
      press: 'a reading surface; a press selects text',
      disabled: 'never disabled',
    },
  },
  {
    component: 'Search mark',
    sheets: [SEARCH],
    tokens: ['.mark'],
    change: /\[aria-current/,
    na: {
      hover: 'an annotation, not a control',
      press: 'an annotation, not a control',
      focus: 'never focusable; focus stays on the finder',
      disabled: 'an annotation, not a control',
    },
  },
  {
    component: 'Back to Tasks link',
    sheets: [FLOW, 'shared/ui/Frame.module.css'],
    tokens: ['.backToTasks'],
    change: { na: 'navigates away; no in-place state' },
    na: { disabled: 'links are never disabled' },
  },
  {
    component: 'Notes title and editor',
    sheets: [FLOW],
    tokens: ['.noteTitle', '.noteEditor'],
    change: /\[aria-invalid|:placeholder-shown/,
    na: {
      press: 'text entry: a press places the caret; focus is the animated state',
      disabled: 'never disabled',
    },
  },
];

function rulesOf(entry: Entry): Rule[] {
  return entry.sheets
    .flatMap((path) => rules(sheet(path)))
    .filter((rule) => !rule.reduced)
    .filter((rule) =>
      rule.selector.split(',').some((part) => entry.tokens.some((t) => hasToken(part, t))),
    );
}

function selectorsWith(entry: Entry, state: RegExp): string[] {
  return rulesOf(entry)
    .flatMap((rule) => rule.selector.split(','))
    .filter((part) => entry.tokens.some((t) => hasToken(part, t)) && state.test(part));
}

const motionOf = (entry: Entry) =>
  rulesOf(entry)
    .flatMap((rule) => rule.body.split(';'))
    .filter((decl) =>
      (entry.surface === true
        ? /^\s*(transition|animation)(-timing-function)?\s*:/
        : /^\s*transition(-timing-function)?\s*:/
      ).test(decl),
    )
    .join(' ');

/** Properties a state rule may change; each must be covered by a token-timed transition. */
const ANIMATABLE = [
  'background',
  'background-color',
  'border-color',
  'border-block-end-color',
  'box-shadow',
  'color',
  'opacity',
  'outline',
  'outline-color',
  'transform',
] as const;
const INTERACTION =
  /:hover|:active|:focus-visible|:focus-within|\[data-(hovered|pressed|focus-visible)/;

/** The element a selector styles: its last compound, with its state conditions removed. */
const targetOf = (part: string): string =>
  (
    part
      .trim()
      .split(/\s+|>|\+|~/)
      .pop() ?? ''
  )
    .replace(/:(not|has)\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/:(hover|active|focus-visible|focus-within|focus|checked|disabled|popover-open)/g, '')
    .replace(/\[[^\]]*\]/g, '');

const covers = (transitionProperty: string, property: string): boolean =>
  transitionProperty === 'all' ||
  transitionProperty === property ||
  (transitionProperty === 'background' && property.startsWith('background')) ||
  (transitionProperty === 'background-color' && property === 'background') ||
  (transitionProperty === 'border-color' && /^border.*color$/.test(property)) ||
  (transitionProperty === 'outline-color' && property === 'outline');

/** Each `property: …` in a rule body. */
const declarations = (body: string) =>
  body
    .split(';')
    .map((decl) => decl.split(':').map((piece) => piece.trim()))
    .filter((pair): pair is [string, string] => pair.length >= 2 && pair[0] !== '');

/**
 * The instant changes in a set of rules: an interaction rule that switches its transition off,
 * or that changes a property no token-timed transition on the same element covers.
 */
export function instantChanges(all: Rule[], tokens: readonly string[]): string[] {
  const live = all.filter((rule) => !rule.reduced);
  const pseudo = (target: string) => /::[\w-]+$/.exec(target)?.[0] ?? '';
  const classes = (target: string): string[] =>
    target.replace(/::[\w-]+$/, '').match(/\.[\w-]+/g) ?? [];
  const isControl = (target: string) => tokens.some((token) => hasToken(target, token));
  // A transition applies when it styles the same element: same pseudo-element, and either its
  // classes are a subset of the state rule's or both name the control (a Button is `.button`
  // and `.interactive` at once).
  const sameElement = (base: string, target: string) =>
    pseudo(base) === pseudo(target) &&
    (classes(base).every((name) => classes(target).includes(name)) ||
      (isControl(base) && isControl(target)));
  const transitionsFor = (target: string) =>
    live
      .filter((rule) =>
        rule.selector.split(',').some((part) => sameElement(targetOf(part), target)),
      )
      .flatMap((rule) =>
        declarations(rule.body)
          .filter(([name]) => name === 'transition')
          .flatMap(([, value]) => value.split(/,(?![^(]*\))/))
          .filter((item) => /var\(--motion-[\w-]+\)/.test(item))
          .map((item) => item.trim().split(/\s+/)[0] ?? ''),
      );
  return live.flatMap((rule) =>
    rule.selector
      .split(',')
      .filter((part) => tokens.some((token) => hasToken(part, token)) && INTERACTION.test(part))
      .flatMap((part) => {
        const decls = declarations(rule.body);
        if (decls.some(([name, value]) => name === 'transition' && /^none\b/.test(value))) {
          return [`${part.trim()}: switches its transition off`];
        }
        const timed = transitionsFor(targetOf(part));
        return decls
          .map(([name]) => name)
          .filter((name) => (ANIMATABLE as readonly string[]).includes(name))
          .filter((name) => !timed.some((property) => covers(property, name)))
          .map((name) => `${part.trim()}: ${name} changes with no token-timed transition`);
      }),
  );
}

describe('motion coverage table: every interactive control animates every state', () => {
  describe.each(MOTION_TABLE)('$component', (entry) => {
    it('declares a token-timed transition, with a release ease for the settle', () => {
      const motion = motionOf(entry);
      expect(motion, 'no token-timed transition').toMatch(/var\(--motion-[\w-]+\)/);
      expect(motion, 'no state/release/enter easing').toMatch(
        /var\(--ease-(state|release|enter)\)/,
      );
    });

    it.each(Object.keys(STATES) as (keyof typeof STATES)[])('styles its %s state', (state) => {
      if (entry.na?.[state] !== undefined) return;
      expect(selectorsWith(entry, STATES[state]), `${entry.component}: ${state}`).not.toEqual([]);
    });

    it('animates what each hover, press and focus changes (nothing snaps)', () => {
      const all = entry.sheets.flatMap((path) => rules(sheet(path)));
      expect(instantChanges(all, entry.tokens)).toEqual([]);
    });

    it('styles its own change state', () => {
      if (!(entry.change instanceof RegExp)) return;
      expect(selectorsWith(entry, entry.change), `${entry.component}: change`).not.toEqual([]);
    });
  });
});

describe('motion tokens and reduced motion', () => {
  const tokens = readFileSync(join(src, 'styles/system.tokens.css'), 'utf8');
  const variant = readFileSync(join(src, 'styles/variant.tokens.css'), 'utf8');
  const reducedBlock =
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([\s\S]*?)\}/.exec(tokens)?.[1] ?? '';
  const reduced = new Map(
    [...reducedBlock.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]?.trim()]),
  );
  /** A primitive's value in ms, from the variant layer (or system, for --p-duration-none). */
  const primitiveMs = (value: string | undefined): number => {
    const name = /var\((--p-duration-[\w-]+)\)/.exec(value ?? '')?.[1];
    if (name === undefined) return NaN;
    const declared = new RegExp(`${name}:\\s*(\\d+)ms`).exec(variant + tokens)?.[1];
    return Number(declared);
  };
  const used = (pattern: RegExp) =>
    new Set(
      componentFiles.flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(pattern)].map((m) => m[1] ?? ''),
      ),
    );

  it.each(componentFiles.map((path) => relative(src, path)))(
    '%s times transitions and animations only with motion tokens',
    (path) => {
      const literal = rules(sheet(path))
        .flatMap((rule) => rule.body.split(';'))
        .filter((decl) => /^\s*(transition|animation)(-duration|-delay)?\s*:/.test(decl))
        .filter((decl) => /(^|[\s,(])\d*\.?\d+m?s\b/.test(decl.split(':').slice(1).join(':')));
      expect(literal).toEqual([]);
    },
  );

  it('makes every timing a component uses a short crossfade (150ms or less) under reduce', () => {
    // A dwell is how long a result stays readable, not an animation, so it keeps its length.
    const dwells = new Set(['--motion-row-hold-duration']);
    // Loops are removed outright by the recipes (see the next test), not shortened.
    const loops = new Set(['--motion-busy-period', '--motion-skeleton-period']);
    const timings = [...used(/var\((--motion-[\w-]+)/g)].filter(
      (token) => !dwells.has(token) && !loops.has(token),
    );
    expect(timings.length).toBeGreaterThan(10);
    const tooLong = timings.filter((token) => !(primitiveMs(reduced.get(token)) <= 150));
    expect(tooLong).toEqual([]);
    // Colour still fades: the hover, press, focus and change timings are not zeroed.
    for (const token of ['--motion-hover-duration', '--motion-focus-duration']) {
      expect(primitiveMs(reduced.get(token)), token).toBe(150);
    }
  });

  it('removes loops (spinner, shimmer) under reduce instead of shortening them', () => {
    const recipes = rules(sheet(RECIPES)).filter((rule) => rule.reduced);
    const stopped = recipes
      .filter((rule) => /animation:\s*none/.test(rule.body))
      .flatMap((rule) => rule.selector.split(',').map((part) => part.trim()));
    expect(stopped).toEqual(expect.arrayContaining(['.spinner', '.skeleton::after']));
  });

  it('sets every movement amplitude to identity under reduce: no travel, scale or turn', () => {
    const amplitudes = [
      ...used(
        /var\((--(?:move-[\w-]+|lift-hover|press-y|press-scale|icon-press-scale|check-press-scale))\)/g,
      ),
    ];
    expect(amplitudes.length).toBeGreaterThan(8);
    const moving = amplitudes.filter((token) => !['0px', '1'].includes(reduced.get(token) ?? ''));
    expect(moving).toEqual([]);
    expect(reduced.get('--motion-turn-duration')).toBe('var(--p-duration-none)');
    expect(reduced.get('--motion-collapse-duration')).toBe('var(--p-duration-none)');
  });

  it('moves only by a movement token, so reduce can never leave an instant jump', () => {
    // Static or token-timed exceptions: the toast region's centring never animates; the spinner
    // is removed under reduce; chevrons turn on --motion-turn-duration, which reduce zeroes.
    const allowed = new Set([
      'translateX(-50%)',
      'rotate(1turn)',
      'rotate(180deg)',
      'rotate(90deg)',
    ]);
    const literal = componentFiles.flatMap((path) =>
      [
        ...readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .matchAll(/transform:\s*([^;]+);/g),
      ]
        .map((m) => (m[1] ?? '').trim())
        .filter((value) => value !== 'none' && !allowed.has(value))
        .filter((value) =>
          /\d/.test(value.replace(/var\([^)]*\)/g, '').replace(/calc\(-1 \*\s*\)/g, '')),
        )
        .map((value) => `${relative(src, path)}: ${value}`),
    );
    expect(literal).toEqual([]);
  });

  it('never floats a result label over the row: no generated label content', () => {
    const floating = allRules
      .filter((rule) => /::(after|before)/.test(rule.selector))
      .filter((rule) => /content:\s*'(Created|Completed|Deleted)/.test(rule.body))
      .map((rule) => rule.selector);
    expect(floating).toEqual([]);
  });

  it('settles a released swipe on its own spatial token, which reduce makes direct', () => {
    expect(reduced.get('--motion-swipe-settle-duration')).toBe('var(--p-duration-none)');
    const row = readFileSync(join(src, 'features/tasks/components/TaskRow.tsx'), 'utf8');
    expect(row).toContain('transform var(--motion-swipe-settle-duration)');
  });

  it('keeps the variant layer the one source of the motion primitives (no stacked overrides)', () => {
    for (const name of ['--p-duration-press', '--p-duration-hover', '--p-ease-standard']) {
      expect(tokens, `${name} restated in system.tokens.css`).not.toContain(`${name}:`);
      expect(variant).toContain(`${name}:`);
    }
  });

  it('never switches the focus transition off: the ring fades in like every other state', () => {
    const snapping = allRules
      .filter((rule) => !rule.reduced && rule.selector.includes(':focus-visible'))
      .filter((rule) => /(^|;)\s*transition\s*:\s*none/.test(rule.body))
      .map((rule) => rule.selector);
    expect(snapping).toEqual([]);
  });

  it('fails a control whose hover and press snap (mutation of the real Use demo account CSS)', () => {
    const real = sheet('features/auth/components/AuthForm.module.css');
    // the same endpoints, reached instantly.
    const snapped = `${real}
.demo:hover, .demo:active, .demo:hover::before, .demo:active::before {
  transition: none !important;
}`;
    expect(instantChanges(rules(real), ['.demo'])).toEqual([]);
    expect(instantChanges(rules(snapped), ['.demo'])).not.toEqual([]);
  });

  it('never scrolls smoothly', () => {
    expect(allRules.filter((rule) => /scroll-behavior\s*:\s*smooth/.test(rule.body))).toEqual([]);
  });
});

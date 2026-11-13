import { expect, test, type Locator, type Page } from '@playwright/test';
import { openScreen, screens, storageStateFor, type Screen } from './support';

// The motion gate in a real browser: every interactive control has a
// token-timed transition at rest, hover and press each change something you can see, and under
// reduced motion colour still fades (150ms at most) while nothing moves, loops or scrolls smoothly. Desktop only: hover is a
// pointer state. The static half of the gate (apps/web/src/styles/motion.test.ts) checks the CSS.

type Control = {
  name: string;
  find: (page: Page) => Locator;
  /** The part that shows the state, when it is not the control itself (a styled box). */
  shows?: (page: Page) => Locator;
  /** Text entry: a press places the caret, so only hover is checked. */
  pressNa?: true;
  /** Set up the page before measuring (open a sheet, hover the row that reveals the control). */
  before?: (page: Page) => Promise<void>;
};

const VISUAL = [
  'background-color',
  'border-color',
  'box-shadow',
  'color',
  'opacity',
  'outline-color',
  'transform',
  'text-decoration-color',
] as const;

type Look = Record<string, string>;

/** What the control looks like: each visual property of the element and of its ::before layer. */
const look = (control: Locator): Promise<Look> =>
  control.evaluate((element, props) => {
    const entries = (['', '::before'] as const).flatMap((pseudo) => {
      const style = getComputedStyle(element, pseudo === '' ? null : pseudo);
      return props.map((prop) => [`${pseudo}${prop}`, style.getPropertyValue(prop)] as const);
    });
    return Object.fromEntries(entries);
  }, VISUAL);

/** Starts recording which properties begin a transition on the control (or its ::before). */
const recordTransitions = (control: Locator) =>
  control.evaluate((element) => {
    element.setAttribute('data-motion-runs', '');
    element.addEventListener('transitionrun', (event) => {
      // Only the control's own transitions: a child's bubble up too, and must not count for it.
      if (!(event instanceof TransitionEvent) || event.target !== element) return;
      const runs = element.getAttribute('data-motion-runs') ?? '';
      element.setAttribute(
        'data-motion-runs',
        `${runs} ${event.pseudoElement}${event.propertyName}`,
      );
    });
  });

/** The transitions that began since the last call, then clears the record. */
const takeTransitions = (control: Locator): Promise<string[]> =>
  control.evaluate((element) => {
    const runs = (element.getAttribute('data-motion-runs') ?? '').split(' ').filter(Boolean);
    element.setAttribute('data-motion-runs', '');
    return runs;
  });

/** The properties that changed between two looks but did not transition: an instant change. */
const snapped = (before: Look, after: Look, runs: readonly string[]): string[] =>
  Object.keys(after)
    .filter((key) => after[key] !== before[key])
    .filter((key) => {
      const pseudo = key.startsWith('::before') ? '::before' : '';
      const prop = key.slice(pseudo.length);
      // A transition on `border-color` runs per side (border-top-color, …).
      const matches = (run: string) =>
        run === key ||
        (prop === 'border-color' && run.startsWith(`${pseudo}border-`) && run.endsWith('-color'));
      // Borders, underlines and the ::before layer drawn in currentColor follow a transitioned
      // `color`: they interpolate with it, not on their own.
      const followsColor = runs.includes('color') && after[key] === after.color;
      return !runs.some(matches) && !followsColor;
    });

/**
 * One sample in the middle of the transition an action starts on `control`: at 30% of its
 * duration the value must lie strictly between where it started and where it ends (an instant
 * change has no middle). With `property`, that property must be the one transitioning: a list
 * Chrome can't interpolate (box-shadows whose inset layers don't line up) starts no transition.
 */
const sampleMid = async (
  page: Page,
  control: Locator,
  act: () => Promise<void>,
  property?: string,
) => {
  await control.evaluate((element, wanted) => {
    element.addEventListener('transitionrun', function sample(event: Event) {
      if (!(event instanceof TransitionEvent) || event.target !== element) return;
      if (wanted !== '' && event.propertyName !== wanted) return;
      element.removeEventListener('transitionrun', sample);
      const transition = element
        .getAnimations({ subtree: true })
        .find(
          (animation): animation is CSSTransition =>
            animation instanceof CSSTransition &&
            animation.transitionProperty === event.propertyName &&
            (animation.effect instanceof KeyframeEffect ? animation.effect.pseudoElement : null) ===
              (event.pseudoElement === '' ? null : event.pseudoElement),
        );
      if (transition === undefined) return;
      transition.pause();
      const duration = Number(transition.effect?.getComputedTiming().duration ?? 0);
      const read = () =>
        getComputedStyle(
          element,
          event.pseudoElement === '' ? null : event.pseudoElement,
        ).getPropertyValue(event.propertyName);
      transition.currentTime = 0;
      const start = read();
      transition.currentTime = duration * 0.3;
      const middle = read();
      transition.currentTime = duration;
      const end = read();
      transition.play();
      element.setAttribute('data-motion-sample', JSON.stringify({ start, middle, end, duration }));
    });
  }, property ?? '');
  await act();
  await settle(page);
  const raw = await control.getAttribute('data-motion-sample');
  expect(raw, `no ${property ?? ''} transition started`).not.toBeNull();
  const parsed: unknown = JSON.parse(raw ?? '{}');
  const field = (name: string): unknown =>
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, name) : undefined;
  expect(Number(field('duration')), 'the transition has no duration').toBeGreaterThan(0);
  expect(field('middle'), 'no in-between value').not.toBe(field('start'));
  expect(field('middle'), 'no in-between value').not.toBe(field('end'));
};

const longestTransition = (control: Locator) =>
  control.evaluate((element) => {
    const seconds = (list: string) =>
      Math.max(...list.split(',').map((value) => Number.parseFloat(value) || 0));
    return Math.max(
      seconds(getComputedStyle(element).transitionDuration),
      seconds(getComputedStyle(element, '::before').transitionDuration),
    );
  });

// Waits for the page to come to rest, without a fixed sleep: one frame so the new hover or press
// state is applied, then every running transition and finite animation to finish (an infinite
// spinner would never finish, so it is skipped).
const settle = (page: Page) =>
  page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    // Reading a style flushes it, which starts any transition the new state triggers.
    getComputedStyle(document.documentElement).getPropertyValue('opacity');
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Task settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Task settings' })).toBeVisible();
  await settle(page);
};

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Task settings' });

const openPriority = async (page: Page) => {
  await openSettings(page);
  await sheet(page)
    .getByRole('button', { name: /Priority/ })
    .click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await settle(page);
};

const openCalendar = async (page: Page) => {
  await openSettings(page);
  await sheet(page).getByRole('button', { name: 'Choose due date' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await settle(page);
};

const firstRow = (page: Page) => page.getByRole('listitem').first();

// Controls are found by role where they have one. A few styled boxes have no role of their own
// (a field's wrapper, the row's surface, the checkbox's drawn box, the Completed <summary>), so
// those few are reached structurally: this spec measures styling, so it targets what is styled.
const PAGES: { screen: string; controls: Control[] }[] = [
  {
    screen: 'sign in',
    controls: [
      { name: 'Email field', find: (p) => p.getByLabel('Email'), pressNa: true },
      { name: 'Password field', find: (p) => p.getByLabel('Password'), pressNa: true },
      { name: 'Show password', find: (p) => p.getByRole('button', { name: 'Show password' }) },
      { name: 'Sign in', find: (p) => p.getByRole('button', { name: 'Sign in' }) },
      {
        name: 'Create an account',
        find: (p) => p.getByRole('link', { name: 'Create an account' }),
      },
      {
        name: 'Use demo account',
        find: (p) => p.getByRole('button', { name: 'Use demo account' }),
      },
    ],
  },
  {
    screen: 'task list',
    controls: [
      { name: 'New task', find: (p) => p.getByRole('button', { name: 'New task' }).first() },
      { name: 'Account menu', find: (p) => p.getByRole('button', { name: 'Account menu' }) },
      {
        name: 'Search field',
        find: (p) => p.getByRole('searchbox', { name: 'Search tasks' }).locator('..'),
        pressNa: true,
      },
      { name: 'Task row', find: (p) => firstRow(p).locator('[data-done]') },
      { name: 'Task title', find: (p) => firstRow(p).getByRole('link') },
      {
        name: 'Task checkbox',
        find: (p) => firstRow(p).getByRole('checkbox').locator('..'),
        shows: (p) => firstRow(p).getByRole('checkbox').locator('xpath=following-sibling::*[1]'),
      },
      {
        name: 'Reorder grip',
        find: (p) => firstRow(p).getByRole('button', { name: /^Reorder / }),
        before: async (p) => {
          await firstRow(p).hover();
        },
      },
      { name: 'Completed group', find: (p) => p.locator('summary').first() },
    ],
  },
  {
    screen: 'task detail',
    controls: [
      {
        name: 'Task settings',
        find: (p) => p.getByRole('button', { name: 'Task settings', exact: true }),
      },
      {
        name: 'Settings close',
        find: (p) => p.getByRole('button', { name: 'Close task settings' }),
        before: openSettings,
      },
      {
        name: 'Settings Move to trash',
        find: (p) =>
          p
            .getByRole('dialog', { name: 'Task settings' })
            .getByRole('button', { name: 'Move to trash' }),
        before: openSettings,
      },
      // The custom controls: no native select or date picker anywhere.
      {
        name: 'Priority select',
        find: (p) => sheet(p).getByRole('button', { name: /Priority/ }),
        before: openSettings,
      },
      {
        name: 'Priority option',
        find: (p) => p.getByRole('option', { name: 'Low' }),
        before: openPriority,
      },
      {
        name: 'Due date field',
        find: (p) => sheet(p).getByRole('group', { name: 'Due date' }),
        before: openSettings,
      },
      {
        name: 'Calendar trigger',
        find: (p) => sheet(p).getByRole('button', { name: 'Choose due date' }),
        before: openSettings,
      },
      {
        name: 'Calendar day',
        // A day in the middle of the month, whichever month the task's date opens on.
        find: (p) => p.getByRole('grid').getByRole('gridcell').nth(17).getByRole('button'),
        before: openCalendar,
      },
      {
        name: 'Calendar Today',
        find: (p) => p.getByRole('button', { name: 'Today', exact: true }),
        before: openCalendar,
      },
    ],
  },
];

const screenNamed = (name: string): Screen => {
  const screen = screens.find((candidate) => candidate.name === name);
  if (screen === undefined) throw new Error(`no screen named ${name}`);
  return screen;
};

for (const { screen: screenName, controls } of PAGES) {
  const screen = screenNamed(screenName);

  test.describe(`motion on ${screenName}`, () => {
    test.use({ storageState: storageStateFor(screen.session) });
    test.skip(
      ({ isMobile }) => isMobile,
      'hover is a pointer state; the desktop project covers it',
    );

    for (const control of controls) {
      test(`${control.name}: hover and press each change how it looks, by a transition`, async ({
        page,
      }) => {
        await openScreen(page, screen);
        await control.before?.(page);
        const target = control.find(page);
        const shows = control.shows?.(page) ?? target;
        await expect(target).toBeVisible();

        expect(await longestTransition(shows), 'no transition at rest').toBeGreaterThan(0);

        await page.mouse.move(0, 0);
        await settle(page);
        const rest = await look(shows);
        await recordTransitions(shows);

        await target.hover();
        await settle(page);
        const hovered = await look(shows);
        expect(hovered, 'hover changes nothing').not.toEqual(rest);
        expect(snapped(rest, hovered, await takeTransitions(shows)), 'hover snapped').toEqual([]);

        if (control.pressNa !== true) {
          await page.mouse.down();
          await settle(page);
          const pressed = await look(shows);
          // Read before releasing: a release may act (toggle the eye, close the sheet).
          const pressRuns = await takeTransitions(shows);
          await page.mouse.up();
          expect(pressed, 'press changes nothing').not.toEqual(hovered);
          expect(snapped(hovered, pressed, pressRuns), 'press snapped').toEqual([]);
        }
      });
    }

    test('reduced motion: colour fades stay short, nothing loops, nothing scrolls smoothly', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openScreen(page, screen);
      if (screenName === 'task detail') await openCalendar(page);
      const moving = await page.evaluate(() => {
        const seconds = (list: string) =>
          Math.max(...list.split(',').map((value) => Number.parseFloat(value) || 0));
        // A dwell keeps a result readable; it animates nothing that moves.
        const dwell = (names: string) =>
          names.split(',').every((name) => /hold|resultLabel/.test(name));
        return [...document.querySelectorAll('*')].flatMap((element) =>
          ([null, '::before', '::after'] as const).flatMap((pseudo) => {
            const style = getComputedStyle(element, pseudo);
            const animated = style.animationName !== 'none';
            const loops = animated && style.animationIterationCount.includes('infinite');
            const long =
              animated && !dwell(style.animationName) && seconds(style.animationDuration) > 0.15;
            const slowFade = seconds(style.transitionDuration) > 0.15;
            const smooth = pseudo === null && style.scrollBehavior === 'smooth';
            return loops || long || slowFade || smooth
              ? [`${element.tagName.toLowerCase()}.${element.className}${pseudo ?? ''}`]
              : [];
          }),
        );
      });
      expect(moving).toEqual([]);
    });
  });
}

// Reduced motion keeps colour feedback: a hover still crossfades, and nothing moves.
test.describe('reduced motion keeps colour, drops movement', () => {
  test.use({ storageState: storageStateFor('none') });
  test.skip(({ isMobile }) => isMobile, 'hover is a pointer state; the desktop project covers it');
  test('Sign in: the hover colour passes through a middle, and the button never moves', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openScreen(page, screenNamed('sign in'));
    await page.mouse.move(0, 0);
    await settle(page);
    const button = page.getByRole('button', { name: 'Sign in' });
    await sampleMid(page, button, () => button.hover(), 'background-color');
    // The fill is the one hover change: no ink layer stacked on top of it.
    expect(await button.evaluate((element) => getComputedStyle(element, '::before').opacity)).toBe(
      '0',
    );
    // Identity: `none`, or a matrix that neither moves nor scales.
    const still = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];
    const transform = () => button.evaluate((element) => getComputedStyle(element).transform);
    await settle(page);
    expect(still).toContain(await transform());
    await page.mouse.down();
    await settle(page);
    expect(still).toContain(await transform());
    await page.mouse.up();
  });
});

// Press and release have their own middles at normal speed: a 120ms compression and a
// 240ms settle, on a filled button.
test.describe('press and release have a middle', () => {
  test.use({ storageState: storageStateFor('none') });
  test.skip(({ isMobile }) => isMobile, 'a mouse press; the touch result is in the lifecycle spec');
  test('Sign in: pressing compresses through a middle, releasing settles through one', async ({
    page,
  }) => {
    await openScreen(page, screenNamed('sign in'));
    const button = page.getByRole('button', { name: 'Sign in' });
    await button.hover();
    await settle(page);
    await sampleMid(page, button, () => page.mouse.down(), 'transform');
    await sampleMid(page, button, () => page.mouse.up(), 'transform');
  });
});

// One control per family, sampled mid-transition: the in-between frame exists.
const FAMILIES: { screen: string; name: string; find: (page: Page) => Locator }[] = [
  {
    screen: 'sign in',
    name: 'button (Sign in)',
    find: (p) => p.getByRole('button', { name: 'Sign in' }),
  },
  {
    screen: 'sign in',
    name: 'quiet action (Use demo account)',
    find: (p) => p.getByRole('button', { name: 'Use demo account' }),
  },
  { screen: 'sign in', name: 'field (Email)', find: (p) => p.getByLabel('Email') },
  {
    screen: 'task list',
    name: 'row (first task)',
    find: (p) => p.getByRole('listitem').first().locator('[data-done]'),
  },
  {
    screen: 'task detail',
    name: 'icon button (Task settings)',
    find: (p) => p.getByRole('button', { name: 'Task settings', exact: true }),
  },
];

test.describe('motion has a middle', () => {
  test.skip(({ isMobile }) => isMobile, 'hover is a pointer state; the desktop project covers it');
  for (const family of FAMILIES) {
    const screen = screenNamed(family.screen);
    test.describe(family.name, () => {
      test.use({ storageState: storageStateFor(screen.session) });
      test(`${family.name}: hover passes through an in-between value`, async ({ page }) => {
        await openScreen(page, screen);
        await page.mouse.move(0, 0);
        await settle(page);
        const control = family.find(page);
        await sampleMid(page, control, () => control.hover());
      });
    });
  }
});

// The gate catches a snap: the same check, on a control whose hover and press are made instant.
test.describe('the motion gate fails an instant change', () => {
  test.use({ storageState: storageStateFor('none') });
  test.skip(({ isMobile }) => isMobile, 'hover is a pointer state; the desktop project covers it');
  test('Use demo account with transition: none is reported as snapped', async ({ page }) => {
    await openScreen(page, screenNamed('sign in'));
    await page.addStyleTag({
      content: `button:is(:hover, :active), button:is(:hover, :active)::before { transition: none !important; }`,
    });
    const demo = page.getByRole('button', { name: 'Use demo account' });
    await page.mouse.move(0, 0);
    await settle(page);
    const rest = await look(demo);
    await recordTransitions(demo);
    await demo.hover();
    await settle(page);
    const hovered = await look(demo);
    expect(snapped(rest, hovered, await takeTransitions(demo))).not.toEqual([]);
  });
});

// Focus has its own transitions, in and out: each field family's ring or edge passes through a
// middle both ways.
// The search ring is a box-shadow, so every search state must keep the same shadow layers.
const FOCUS: {
  screen: string;
  name: string;
  /** The element that draws the ring. */
  ring: (page: Page) => Locator;
  /** How focus arrives (keyboard focus, so :focus-visible applies). */
  focus: (page: Page) => Promise<void>;
  property: string;
}[] = [
  {
    screen: 'task list',
    name: 'search field ring (box-shadow)',
    ring: (p) => p.getByRole('searchbox', { name: 'Search tasks' }).locator('..'),
    focus: (p) => p.getByRole('searchbox', { name: 'Search tasks' }).focus(),
    property: 'box-shadow',
  },
  {
    screen: 'sign in',
    name: 'auth field ring (outline)',
    ring: (p) => p.getByLabel('Email'),
    focus: (p) => p.getByLabel('Email').focus(),
    property: 'outline-color',
  },
  {
    screen: 'task detail',
    name: 'priority select ring (outline)',
    ring: (p) => sheet(p).getByRole('button', { name: /Priority/ }),
    focus: async (p) => {
      await p.keyboard.press('Shift+Tab');
      await sheet(p)
        .getByRole('button', { name: /Priority/ })
        .focus();
    },
    property: 'outline-color',
  },
  {
    screen: 'task detail',
    name: 'date field edge (border)',
    ring: (p) => sheet(p).getByRole('group', { name: 'Due date' }),
    focus: (p) =>
      sheet(p).getByRole('group', { name: 'Due date' }).getByRole('spinbutton').first().focus(),
    property: 'border-top-color',
  },
];

test.describe('focus has a middle', () => {
  test.skip(({ isMobile }) => isMobile, 'the desktop project covers motion');
  for (const field of FOCUS) {
    const screen = screenNamed(field.screen);
    test.describe(field.name, () => {
      test.use({ storageState: storageStateFor(screen.session) });
      test(`${field.name}: focus passes through an in-between value`, async ({ page }) => {
        await openScreen(page, screen);
        if (field.screen === 'task detail') await openSettings(page);
        await page.mouse.move(0, 0);
        await settle(page);
        await sampleMid(page, field.ring(page), () => field.focus(page), field.property);
      });

      test(`${field.name}: losing focus passes through an in-between value`, async ({ page }) => {
        await openScreen(page, screen);
        if (field.screen === 'task detail') await openSettings(page);
        await page.mouse.move(0, 0);
        await field.focus(page);
        await settle(page);
        // Focus moves to the page itself, so nothing else in the sheet starts its own transition.
        await sampleMid(
          page,
          field.ring(page),
          () =>
            page.evaluate(() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }),
          field.property,
        );
      });
    });
  }
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import { Task } from '@todo/contracts';
import { storageStateFor } from './support';

// Row lifecycle at normal speed: adding, completing,
// reopening and deleting a task each run a visible phase, owned by the list, before the row
// settles. Each phase is sampled in the page the moment it starts, at 30% of its own animation:
// the value there must lie strictly between where the animation starts and where it ends. Nothing
// is slowed down or paused for the user; the sample pauses one animation for one read, then plays
// it on from where it was.

test.use({ storageState: storageStateFor('demo') });

type Sample = { start: string; middle: string; end: string; duration: number };
type Dwell = { from: number; to: number };

// What the in-page watchers record, read back by the test.
declare global {
  // Declaration merging needs an interface.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    motionSamples?: Record<string, Sample>;
    motionDwells?: Record<string, Dwell>;
  }
}

/**
 * Samples the first CSS animation of `part` (inside the first element matching `selector`, or the
 * element itself when `part` is empty) that animates `property`, as soon as that element appears.
 */
const watchAnimation = (
  page: Page,
  name: string,
  selector: string,
  part: string,
  property: string,
) =>
  page.evaluate(
    ({ name, selector, part, property }) => {
      window.motionSamples ??= {};
      const samples = window.motionSamples;
      const camel = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      const sample = (host: Element): boolean => {
        const target = part === '' ? host : host.querySelector(part);
        if (target === null) return false;
        const animation = target
          .getAnimations()
          .find(
            (candidate) =>
              candidate instanceof CSSAnimation &&
              candidate.effect instanceof KeyframeEffect &&
              candidate.effect.getKeyframes().some((frame) => camel in frame),
          );
        if (animation === undefined) return false;
        const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
        const was = animation.currentTime ?? 0;
        const read = () => getComputedStyle(target).getPropertyValue(property);
        animation.pause();
        animation.currentTime = 0;
        const start = read();
        animation.currentTime = duration * 0.3;
        const middle = read();
        animation.currentTime = duration * 0.98;
        const end = read();
        animation.currentTime = was;
        animation.play();
        samples[name] = { start, middle, end, duration };
        return true;
      };
      const observer = new MutationObserver(() => {
        for (const host of document.querySelectorAll(selector)) {
          if (sample(host)) {
            observer.disconnect();
            return;
          }
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      });
    },
    { name, selector, part, property },
  );

/** Records when an element matching `selector` first appears and when it is gone again. */
const watchDwell = (page: Page, name: string, selector: string) =>
  page.evaluate(
    ({ name, selector }) => {
      window.motionDwells ??= {};
      const dwells = window.motionDwells;
      const observer = new MutationObserver(() => {
        const present = document.querySelector(selector) !== null;
        const dwell = dwells[name];
        if (present && dwell === undefined) dwells[name] = { from: performance.now(), to: NaN };
        if (!present && dwell !== undefined && Number.isNaN(dwell.to)) {
          dwell.to = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      });
    },
    { name, selector },
  );

const sampleOf = async (page: Page, name: string): Promise<Sample> => {
  const read = () => page.evaluate((key) => window.motionSamples?.[key] ?? null, name);
  await expect.poll(read, { message: `${name}: the animation never started` }).not.toBeNull();
  const sample = await read();
  if (sample === null) throw new Error(`${name}: no sample`);
  return sample;
};

const dwellOf = async (page: Page, name: string): Promise<number> => {
  const read = () =>
    page.evaluate((key) => {
      const dwell = window.motionDwells?.[key];
      return dwell === undefined || Number.isNaN(dwell.to) ? null : dwell.to - dwell.from;
    }, name);
  await expect.poll(read, { message: `${name}: never appeared and left` }).not.toBeNull();
  return (await read()) ?? NaN;
};

const numbers = (value: string) => (value.match(/-?\d*\.?\d+(e-?\d+)?/g) ?? []).map(Number);

/** Some number in the middle lies strictly between the same number at the start and the end. */
const inBetween = ({ start, middle, end }: Sample): boolean => {
  const [s, m, e] = [numbers(start), numbers(middle), numbers(end)];
  return m.some((value, index) => {
    const from = s[index];
    const to = e[index];
    if (from === undefined || to === undefined || from === to) return false;
    return value > Math.min(from, to) + 1e-3 && value < Math.max(from, to) - 1e-3;
  });
};

const expectMiddle = (sample: Sample, what: string) => {
  expect(inBetween(sample), `${what}: ${JSON.stringify(sample)}`).toBe(true);
};

/** Creates a task through the API, so each test acts on its own rows. */
const createTask = async (page: Page, title: string): Promise<Task> => {
  const response = await page.request.post('/api/tasks', { data: { title } });
  expect(response.ok()).toBe(true);
  return Task.parse(await response.json());
};

const created: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of created.splice(0)) await page.request.delete(`/api/tasks/${id}`);
});

const openList = (page: Page) => page.getByRole('list', { name: 'Open tasks' });
const rowNamed = (scope: Locator, title: string) => scope.getByRole('listitem', { name: title });

const openTasks = async (page: Page, titles: string[]) => {
  for (const title of titles) created.push((await createTask(page, title)).id);
  await page.goto('/tasks');
  await expect(rowNamed(openList(page), titles[0] ?? '')).toBeVisible();
};

test.describe('row lifecycle at normal speed', () => {
  test('complete: the box fills and the check draws in place, holds, then the row sinks and its slot collapses', async ({
    page,
  }) => {
    const title = `Complete me ${String(Date.now())}`;
    await openTasks(page, [title]);
    const ghost = '[data-phase="completing"], [data-phase="leaving"][data-exit="complete"]';
    await watchAnimation(
      page,
      'check',
      '[data-phase="completing"]',
      'input + span svg',
      'stroke-dashoffset',
    );
    await watchAnimation(
      page,
      'sink',
      '[data-phase="leaving"][data-exit="complete"]',
      '[data-done]',
      'transform',
    );
    await watchAnimation(
      page,
      'collapse',
      '[data-phase="leaving"][data-exit="complete"]',
      '',
      'grid-template-rows',
    );
    await watchDwell(page, 'checked', '[data-phase="completing"]');
    await watchDwell(page, 'ghost', ghost);

    await page.getByRole('checkbox', { name: `Mark ${title} as done` }).click();

    expectMiddle(await sampleOf(page, 'check'), 'the check draws');
    expectMiddle(await sampleOf(page, 'sink'), 'the row sinks');
    expectMiddle(await sampleOf(page, 'collapse'), 'the slot collapses');
    // The checked result stays readable (check 220ms + hold 180ms) before the row leaves.
    expect(await dwellOf(page, 'checked')).toBeGreaterThanOrEqual(380);
    expect(await dwellOf(page, 'ghost')).toBeGreaterThanOrEqual(580);
    await expect(rowNamed(openList(page), title)).toHaveCount(0);
    await expect(page.locator(ghost)).toHaveCount(0);
    await page.getByText('Completed', { exact: true }).click();
    await expect(
      rowNamed(page.getByRole('list', { name: 'Completed tasks' }), title),
    ).toBeVisible();
  });

  test('reopen: the row enters the open list from below', async ({ page }) => {
    const title = `Reopen me ${String(Date.now())}`;
    await openTasks(page, [title]);
    const task = created.at(-1) ?? '';
    await page.request.patch(`/api/tasks/${task}`, { data: { status: 'done' } });
    await page.reload();
    await page.getByText('Completed', { exact: true }).click();
    await watchAnimation(page, 'enter', '[data-phase="entering"]', '[data-done]', 'transform');

    // While the reopened row fades in, the phone's swipe underlay must not show through it.
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        const slot = document.querySelector('[data-phase="entering"]');
        const underlay = slot?.querySelector('[data-armed]');
        if (!slot) return;
        observer.disconnect();
        document.body.dataset.underlayAtEntry =
          underlay instanceof Element ? getComputedStyle(underlay).visibility : 'absent';
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-phase'],
      });
    });

    await page.getByRole('checkbox', { name: `Mark ${title} as done` }).click();

    expectMiddle(await sampleOf(page, 'enter'), 'the reopened row enters');
    expect(['hidden', 'absent']).toContain(
      await page.locator('body').getAttribute('data-underlay-at-entry'),
    );
    await expect(rowNamed(openList(page), title)).toBeVisible();
  });

  test('add: the pending row enters once, then the confirmed row washes and says Created for 1.5s', async ({
    page,
  }) => {
    await openTasks(page, [`Anchor ${String(Date.now())}`]);
    const title = `Added ${String(Date.now())}`;
    // The server answers after a beat, so the pending row is on screen long enough to see.
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const response = await route.fetch();
      created.push(Task.parse(await response.json()).id);
      return route.fulfill({ response });
    });
    await watchAnimation(page, 'pending', '[aria-label="Saving tasks"] li', '', 'opacity');
    await watchAnimation(page, 'wash', '[data-phase="created"]', '[data-done]', 'background-color');
    await watchDwell(page, 'created', '[data-phase="created"]');

    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByRole('textbox', { name: 'New task' }).fill(title);
    await page.keyboard.press('Enter');

    expectMiddle(await sampleOf(page, 'pending'), 'the pending row enters');
    expectMiddle(await sampleOf(page, 'wash'), 'the created row washes');
    await expect(rowNamed(openList(page), title)).toBeVisible();
    // One row: the confirmed row replaces the pending one, it does not enter again.
    await expect(page.getByRole('list', { name: 'Saving tasks' })).toHaveCount(0);
    expect(await dwellOf(page, 'created')).toBeGreaterThanOrEqual(1400);
  });

  test('delete: the row slides out, its slot collapses, and the result says Deleted', async ({
    page,
    isMobile,
  }) => {
    const title = `Delete me ${String(Date.now())}`;
    await openTasks(page, [title, `Keep me ${String(Date.now())}`]);
    await watchAnimation(
      page,
      'slide',
      '[data-phase="leaving"][data-exit="delete"]',
      '[data-done]',
      'transform',
    );
    await watchAnimation(
      page,
      'collapse',
      '[data-phase="leaving"][data-exit="delete"]',
      '',
      'grid-template-rows',
    );

    if (isMobile) {
      await rowNamed(openList(page), title).getByRole('button', { name: 'Task options' }).click();
      await page
        .getByRole('dialog', { name: 'Task settings' })
        .getByRole('button', { name: 'Move to trash' })
        .click();
    } else {
      await page.getByRole('link', { name: title }).click();
      await page.getByRole('button', { name: `Move “${title}” to trash` }).click();
    }

    expectMiddle(await sampleOf(page, 'slide'), 'the row slides out');
    expectMiddle(await sampleOf(page, 'collapse'), 'the slot collapses');
    await expect(page.getByRole('status').filter({ hasText: 'Moved to trash' })).toBeVisible();
    await expect(rowNamed(openList(page), title)).toHaveCount(0);
  });
});

test.describe('swipe handoff on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'swipe gestures are the phone tier');

  test('a swiped completion settles back from the finger while the check draws, with no snap', async ({
    page,
  }) => {
    const title = `Swipe me ${String(Date.now())}`;
    await openTasks(page, [title]);
    await watchAnimation(page, 'return', '[data-phase="completing"]', '[data-done]', 'transform');
    const row = rowNamed(openList(page), title);
    const box = await row.boundingBox();
    if (box === null) throw new Error('no row box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    // To the left: Complete (to the right moves the task to the trash).
    for (const dx of [20, 50, 80, 110, 140]) await page.mouse.move(box.x + box.width / 2 - dx, y);
    await page.mouse.up();

    const settle = await sampleOf(page, 'return');
    // It starts where the finger let go (a translateX of about -140px), not at rest.
    expect(numbers(settle.start)[4] ?? 0, JSON.stringify(settle)).toBeLessThan(-100);
    expectMiddle(settle, 'the swiped row settles back');
    await expect(rowNamed(openList(page), title)).toHaveCount(0);
  });

  test('a row swiped to the trash slides out from the finger, with no snap back first', async ({
    page,
  }) => {
    const title = `Swipe away ${String(Date.now())}`;
    await openTasks(page, [title, `Stay ${String(Date.now())}`]);
    await watchAnimation(
      page,
      'away',
      '[data-phase="leaving"][data-exit="delete"]',
      '[data-done]',
      'transform',
    );
    const row = rowNamed(openList(page), title);
    const box = await row.boundingBox();
    if (box === null) throw new Error('no row box');
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2 - 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const dx of [20, 50, 80, 110, 140]) await page.mouse.move(x + dx, y);
    await page.mouse.up();

    const away = await sampleOf(page, 'away');
    // It starts where the finger let go (a translateX of about 140px), not at rest.
    expect(numbers(away.start)[4] ?? 0, JSON.stringify(away)).toBeGreaterThan(100);
    await expect(rowNamed(openList(page), title)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Moved to trash' })).toBeVisible();
  });

  test('with reduced motion a cancelled swipe returns directly, while colour still fades', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const title = `Cancel me ${String(Date.now())}`;
    await openTasks(page, [title]);
    const row = rowNamed(openList(page), title);
    const surface = row.locator('[data-done]');
    const box = await row.boundingBox();
    if (box === null) throw new Error('no row box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (const dx of [10, 25, 40]) await page.mouse.move(box.x + box.width / 2 + dx, y);
    // The finger is tracked directly: the row is under it before release.
    expect(await surface.evaluate((element) => getComputedStyle(element).transform)).not.toBe(
      'none',
    );
    await page.mouse.up();
    // One frame later the row is back at rest: no position transition runs.
    const after = await surface.evaluate(
      (element) =>
        new Promise<{ transform: string; moving: number }>((resolve) => {
          requestAnimationFrame(() => {
            resolve({
              transform: getComputedStyle(element).transform,
              moving: element
                .getAnimations()
                .filter(
                  (animation) =>
                    animation instanceof CSSTransition &&
                    animation.transitionProperty === 'transform',
                ).length,
            });
          });
        }),
    );
    expect(after.moving).toBe(0);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(after.transform);
  });
});

test.describe('result labels sit in the row', () => {
  test('Created takes its own place beside the title instead of covering it', async ({ page }) => {
    const anchorTitle = `Anchor ${String(Date.now())}`;
    await openTasks(page, [anchorTitle]);
    const title = `A long new task title that reaches the label ${String(Date.now())}`;
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByRole('textbox', { name: 'New task' }).fill(title);
    await page.keyboard.press('Enter');
    const row = rowNamed(openList(page), title);
    const label = row.getByText('Created');
    await expect(label).toBeVisible();
    created.push((await row.getAttribute('data-presence')) ?? '');
    const [titleBox, labelBox] = await Promise.all([
      row.getByRole('link').locator('span').first().boundingBox(),
      label.boundingBox(),
    ]);
    if (titleBox === null || labelBox === null) throw new Error('no boxes');
    const overlaps =
      titleBox.x < labelBox.x + labelBox.width &&
      labelBox.x < titleBox.x + titleBox.width &&
      titleBox.y < labelBox.y + labelBox.height &&
      labelBox.y < titleBox.y + titleBox.height;
    expect(overlaps, JSON.stringify({ titleBox, labelBox })).toBe(false);
  });
});

test.describe('row lifecycle with reduced motion', () => {
  test('complete fades without travel: the row does not sink, its slot does not animate', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const title = `Quietly ${String(Date.now())}`;
    await openTasks(page, [title]);
    await watchAnimation(
      page,
      'fade',
      '[data-phase="leaving"][data-exit="complete"]',
      '[data-done]',
      'opacity',
    );
    await watchAnimation(
      page,
      'still',
      '[data-phase="leaving"][data-exit="complete"]',
      '[data-done]',
      'transform',
    );

    await page.getByRole('checkbox', { name: `Mark ${title} as done` }).click();

    const fade = await sampleOf(page, 'fade');
    expectMiddle(fade, 'the row fades');
    expect(fade.duration).toBeLessThanOrEqual(150);
    // Identity throughout: `none`, or a matrix that neither moves nor scales.
    const still = await sampleOf(page, 'still');
    for (const value of [still.start, still.middle, still.end]) {
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)'], JSON.stringify(still)).toContain(value);
    }
    await expect(rowNamed(openList(page), title)).toHaveCount(0);
  });
});

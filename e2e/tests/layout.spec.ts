import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';
import { openScreen, screens, storageStateFor, type Screen } from './support';

const documentOverflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      x: root.scrollWidth - window.innerWidth,
      y: root.scrollHeight - window.innerHeight,
      scrollTop: root.scrollTop,
    };
  });

const fixedRowsOf = async (page: Page) => {
  const rows = [page.getByRole('banner'), page.getByRole('toolbar'), page.getByRole('contentinfo')];
  const counts = await Promise.all(rows.map((row) => row.count()));
  return rows.filter((_, index) => counts[index] === 1);
};

const bottomOf = (box: { y: number; height: number } | null) => (box ? box.y + box.height : NaN);

const scrollingPartOf = async (pane: Locator): Promise<ElementHandle<Element>> => {
  const handle = await pane.evaluateHandle(
    (element) =>
      [element, ...Array.from(element.querySelectorAll('*'))].find(
        (node) =>
          node.getClientRects().length > 0 &&
          ['auto', 'scroll'].includes(getComputedStyle(node).overflowY),
      ) ?? element,
  );
  return handle.asElement();
};

const scrollerFor = async (page: Page, screenName: string): Promise<ElementHandle<Element>> => {
  if (screenName === 'task detail') {
    return scrollingPartOf(page.getByRole('region', { name: 'Task notes' }));
  }
  if (['task list', 'long task list', 'no search results'].includes(screenName)) {
    return scrollingPartOf(page.getByRole('region', { name: 'Task list' }));
  }
  return scrollingPartOf(page.getByRole('main'));
};

const expectFramed = async (
  page: Page,
  screenName: string,
  { mustOverflow }: { mustOverflow: boolean },
) => {
  const main = await scrollerFor(page, screenName);
  const footer = page.getByRole('contentinfo');
  const fixedRows = await fixedRowsOf(page);

  const before = await documentOverflow(page);
  expect(before.x, 'the document scrolls sideways').toBeLessThanOrEqual(0);
  expect(before.y, 'the document scrolls vertically').toBeLessThanOrEqual(0);

  await expect(footer).toHaveCount(1);
  const viewportHeight = page.viewportSize()?.height ?? NaN;
  expect(bottomOf(await footer.boundingBox()), 'the footer is not at the bottom').toBeCloseTo(
    viewportHeight,
    0,
  );

  expect(bottomOf(await main.boundingBox())).toBeLessThanOrEqual(
    (await footer.boundingBox())?.y ?? NaN,
  );
  const scroller = await main.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    overflows: element.scrollHeight > element.clientHeight,
  }));
  expect(['auto', 'scroll'], '<main> is not a scroll container').toContain(scroller.overflowY);
  if (mustOverflow) expect(scroller.overflows, 'the content does not overflow <main>').toBe(true);

  const boxesBefore = await Promise.all(fixedRows.map((row) => row.boundingBox()));
  await main.evaluate((element) => {
    element.scrollTo(0, element.scrollHeight);
  });
  if (mustOverflow) expect(await main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const boxesAfter = await Promise.all(fixedRows.map((row) => row.boundingBox()));
  expect(boxesAfter, 'a fixed row moved when <main> scrolled').toEqual(boxesBefore);
  expect((await documentOverflow(page)).scrollTop).toBe(0);
};

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.use({ storageState: storageStateFor(screen.session) });

    test('stays in its frame: only <main> scrolls', async ({ page }) => {
      await openScreen(page, screen);
      await expectFramed(page, screen.name, { mustOverflow: screen.longContent === true });
    });
  });
}

// Screens without a toolbar row, on a viewport too short for their content: <main> must take

const shortViewportHeight = 360;
const toolbarlessScreens = screens.filter((screen: Screen) =>
  ['sign in', 'task detail'].includes(screen.name),
);

for (const screen of toolbarlessScreens) {
  test.describe(`${screen.name} on a short viewport`, () => {
    test.use({ storageState: storageStateFor(screen.session) });

    test('scrolls inside <main> with the footer at the bottom', async ({ page }) => {
      const width = page.viewportSize()?.width ?? 0;
      await page.setViewportSize({ width, height: shortViewportHeight });
      await openScreen(page, screen);
      await expectFramed(page, screen.name, { mustOverflow: true });
    });
  });
}

import { expect, test, type Page } from '@playwright/test';
import { TaskList } from '@todo/contracts';
import { storageStateFor } from './support';

test.use({ storageState: storageStateFor('demo') });

const taskId = async (page: Page, title: string): Promise<string> => {
  const response = await page.request.get('/api/tasks');
  const task = TaskList.parse(await response.json()).items.find((item) => item.title === title);
  if (task === undefined) throw new Error(`No demo task "${title}"`);
  return task.id;
};

const finder = (page: Page) => page.getByRole('group', { name: 'Search matches' });
const reading = (page: Page) => page.getByRole('region', { name: 'Task with search matches' });
const counter = (page: Page) => finder(page).getByText(/^\d+ of \d+\+?$/);

test('the list says where each hit matched under its marked title, never a note excerpt', async ({
  page,
}) => {
  await page.goto('/tasks?q=budget');

  const row = page
    .getByRole('list', { name: 'Search results' })
    .getByRole('listitem', { name: "Plan next year's household budget" });
  await expect(row.locator('mark').first()).toBeVisible();
  const link = row.getByRole('link').first();
  await expect(link.getByText(/^\d+\+? match(es)? in (notes|checklist)/)).toBeVisible();
  await expect(page.getByText(/^\d+ results? · reorder paused$/)).toBeVisible();

  const title = await row.locator('mark').first().boundingBox();
  const summary = await link.getByText(/ in (notes|checklist)/).boundingBox();
  expect(summary !== null && title !== null && summary.y > title.y).toBe(true);
});

test('accents fold: "cafe" finds and marks Café', async ({ page }) => {
  await page.goto('/tasks?q=cafe');
  const row = page.getByRole('listitem', { name: 'Café catch-up with the study group' });
  await expect(row.locator('mark', { hasText: 'Café' }).first()).toBeVisible();
});

test('a typo offers the server suggestion and applies it', async ({ page }) => {
  await page.goto('/tasks?q=sunscren');
  await expect(page.getByText('Showing close matches')).toBeVisible();

  await page.getByRole('button', { name: /^sunscreen$/i }).click();
  await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue(/^sunscreen$/i);
  await expect(page).toHaveURL(/q=sunscreen/i);
});

test('the open note marks every match and steps through them inside its own scroller', async ({
  page,
}) => {
  const id = await taskId(page, "Plan next year's household budget");
  await page.goto(`/tasks/${id}?q=budget`);

  await expect(counter(page)).toHaveText(/^1 of \d+$/);
  const total = Number((await counter(page).textContent())?.split(' of ')[1]);
  await expect(reading(page).locator('mark')).toHaveCount(total);
  expect(total).toBeGreaterThan(5);

  const next = finder(page).getByRole('button', { name: 'Next match' });
  for (let step = 2; step <= total; step += 1) {
    await next.click();
    await expect(counter(page)).toHaveText(`${String(step)} of ${String(total)}`);
  }
  const current = reading(page).locator('mark[aria-current="true"]');
  await expect(current).toBeInViewport();
  await next.click();
  await expect(counter(page)).toHaveText(`1 of ${String(total)}`);
  await expect(finder(page).getByRole('status')).toContainText('Wrapped to first match');

  expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollTop])).toEqual([
    0, 0,
  ]);
});

test('a checklist-only match is shown in the open task, never as a note match', async ({
  page,
}) => {
  const id = await taskId(page, 'Pack for the Lisbon trip');
  await page.goto(`/tasks/${id}?q=sunscreen`);

  await expect(counter(page)).toHaveText(/^1 of \d+$/);
  const items = reading(page).getByRole('region', { name: 'Matching checklist items' });
  await expect(items.locator('mark', { hasText: /sunscreen/i }).first()).toBeVisible();
  await expect(finder(page).getByRole('status')).toContainText('Checklist item');
});

test('Edit note pauses the marks; clearing the search keeps the task open', async ({ page }) => {
  const id = await taskId(page, "Plan next year's household budget");
  await page.goto(`/tasks/${id}?q=budget`);
  await expect(counter(page)).toHaveText(/^1 of \d+$/);

  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByRole('textbox', { name: 'Notes' })).toBeFocused();
  await expect(finder(page).getByRole('status')).toHaveText('Highlighting paused while editing');

  await finder(page).getByRole('button', { name: 'Clear search' }).click();
  await expect(finder(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.getByRole('textbox', { name: 'Notes' })).toBeVisible();
});

test('clearing from the read view puts the editor caret on the current match', async ({ page }) => {
  const id = await taskId(page, "Plan next year's household budget");
  await page.goto(`/tasks/${id}?q=budget`);
  await expect(counter(page)).toHaveText(/^1 of \d+$/);
  await expect(reading(page)).toBeFocused();
  await finder(page).getByRole('button', { name: 'Previous match' }).click();
  await finder(page).getByRole('button', { name: 'Clear search' }).press('Enter');
  const notes = page.getByRole('textbox', { name: 'Notes' });
  await expect(notes).toBeFocused();
  const caret = await notes.evaluate((field: HTMLTextAreaElement) => field.selectionStart);
  expect(caret).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('opening a result from the keyboard on a phone puts focus in the read view', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the phone tier hides the list when a note opens');
  await page.goto('/tasks?q=budget');
  const row = page.getByRole('list', { name: 'Search results' }).getByRole('listitem').first();
  await row.getByRole('link').first().focus();
  await page.keyboard.press('Enter');
  await expect(counter(page)).toHaveText(/^1 of \d+\+?$/);
  await expect(reading(page)).toBeFocused();
});

test('clearing at the last match keeps it in view where it was, in the editor', async ({
  page,
}) => {
  const id = await taskId(page, "Plan next year's household budget");
  await page.goto(`/tasks/${id}?q=budget`);
  await expect(counter(page)).toHaveText(/^1 of \d+$/);
  await finder(page).getByRole('button', { name: 'Previous match' }).click();
  const scroller = page.locator('.notesBody').first();
  const markTop = () =>
    reading(page)
      .locator('mark[aria-current="true"]')
      .evaluate((mark) => mark.getBoundingClientRect().top);

  const view = await scroller.boundingBox();
  if (view === null) throw new Error('no scroller');
  let before = await markTop();
  await expect
    .poll(
      async () => {
        const now = await markTop();
        const settled = now === before && now > view.y && now < view.y + view.height - 20;
        before = now;
        return settled;
      },
      { intervals: [300] },
    )
    .toBe(true);

  await finder(page).getByRole('button', { name: 'Clear search' }).press('Enter');
  const notes = page.getByRole('textbox', { name: 'Notes' });
  await expect(notes).toBeFocused();

  await expect(page.locator('[data-exiting]')).toHaveCount(0);
  const caret = await notes.evaluate((field: HTMLTextAreaElement) => {
    const style = getComputedStyle(field);
    const mirror = document.createElement('div');
    for (const name of ['width', 'padding', 'font', 'letter-spacing', 'line-height', 'border']) {
      mirror.style.setProperty(name, style.getPropertyValue(name));
    }
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.textContent = field.value.slice(0, field.selectionStart);
    const mark = document.createElement('span');
    mark.textContent = '\u200b';
    mirror.append(mark);
    document.body.append(mirror);
    const top = field.getBoundingClientRect().top + mark.offsetTop;
    mirror.remove();
    return top;
  });
  const box = await scroller.boundingBox();
  if (box === null) throw new Error('no scroller');
  expect(caret).toBeGreaterThan(box.y);
  expect(caret).toBeLessThan(box.y + box.height - 20);
  expect(Math.abs(caret - before)).toBeLessThan(80);
});

for (const [tier, width, height] of [
  ['T1 desktop', 1440, 900],
  ['T2 tablet', 820, 1180],
  ['T3 foldable', 836, 900],
  ['T4 phone', 390, 844],
  ['T4 cover', 344, 882],
] as const) {
  test(`${tier}: New task sits at the end of the search row, at the field's height`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/tasks');
    const field = page.getByRole('search');
    const create = page.getByRole('button', { name: 'New task' });
    await expect(create).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeAttached();

    const [fieldBox, createBox] = [await field.boundingBox(), await create.boundingBox()];
    if (fieldBox === null || createBox === null) throw new Error('not laid out');
    expect(createBox.height).toBe(fieldBox.height);
    expect(createBox.y).toBe(fieldBox.y);
    expect(createBox.x).toBeGreaterThan(fieldBox.x + fieldBox.width);
    const phone = width < 600;
    await expect(create.getByText('New task')).toBeVisible({ visible: !phone });
    if (phone) {
      expect(createBox.width).toBe(44);
      expect(await create.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}

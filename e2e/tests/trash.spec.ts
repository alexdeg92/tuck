import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { Task, TrashList } from '@todo/contracts';
import { storageStateFor } from './support';

// The Trash through the real stack: a moved task leaves the list and search, and
// comes back in its old place from the Trash or from Undo; Delete forever and Empty trash are
// permanent, behind the custom dialog. Moving needs no confirmation.

test.use({ storageState: storageStateFor('demo') });

const created: string[] = [];

test.afterEach(async ({ page }) => {
  for (const id of created.splice(0)) {
    await page.request.delete(`/api/tasks/${id}`);
    await page.request.delete(`/api/trash/${id}`);
  }
});

const openList = (page: Page) => page.getByRole('list', { name: 'Open tasks' });
const rowNamed = (page: Page, title: string) =>
  openList(page).getByRole('listitem', { name: title });
const undoOffer = (page: Page) => page.getByRole('status').filter({ hasText: 'Moved to trash' });

/** Three new tasks listed A, B, C at the top; returns their titles and the stamp-filtered order. */
const threeTasks = async (page: Page) => {
  const stamp = String(Date.now());
  const [a, b, c] = [`A ${stamp}`, `B ${stamp}`, `C ${stamp}`];
  for (const title of [c, b, a]) {
    const response = await page.request.post('/api/tasks', { data: { title } });
    expect(response.ok()).toBe(true);
    created.push(Task.parse(await response.json()).id);
  }
  await page.goto('/tasks');
  await expect(rowNamed(page, a)).toBeVisible();
  const order = async () => {
    const names = await openList(page)
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? ''));
    return names.filter((name) => name.endsWith(stamp));
  };
  return { a, b, c, stamp, order };
};

/** Desktop moves from the open task's notes head; a phone from the row's options sheet. */
const moveToTrash = async (page: Page, title: string, isMobile: boolean) => {
  const row = rowNamed(page, title);
  if (isMobile) {
    await row.getByRole('button', { name: 'Task options' }).click();
    await page
      .getByRole('dialog', { name: 'Task settings' })
      .getByRole('button', { name: 'Move to trash' })
      .click();
  } else {
    await page.getByRole('link', { name: title }).click();
    await page
      .getByRole('region', { name: 'Task notes' })
      .getByRole('button', { name: `Move “${title}” to trash` })
      .click();
  }
  await expect(undoOffer(page)).toBeVisible();
  await expect(rowNamed(page, title)).toHaveCount(0);
};

test('a moved task leaves the list and search, and Restore puts it back in place', async ({
  page,
  isMobile,
}) => {
  const { a, b, c, stamp, order } = await threeTasks(page);

  await moveToTrash(page, b, isMobile);
  await expect.poll(order).toEqual([a, c]);

  await page.goto(`/tasks?q=${encodeURIComponent(stamp)}`);
  await expect(page.getByRole('listitem', { name: a })).toBeVisible();
  await expect(page.getByRole('listitem', { name: b })).toHaveCount(0);

  await page.goto('/tasks');
  await page.getByRole('link', { name: /^Trash \d+ tasks?$/ }).click();
  await expect(page).toHaveURL(/\/trash$/);
  const trashed = page.getByRole('list', { name: 'Trashed tasks' });
  await expect(trashed.getByRole('link', { name: new RegExp(b) })).toContainText('Deletes in');
  await trashed.getByRole('button', { name: `Restore “${b}”` }).click();
  await expect(trashed.getByRole('link', { name: new RegExp(b) })).toHaveCount(0);

  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect.poll(order).toEqual([a, b, c]);
  await page.reload();
  await expect.poll(order).toEqual([a, b, c]);
});

test('Undo on "Moved to trash" brings the task back in place', async ({ page, isMobile }) => {
  const { a, b, c, order } = await threeTasks(page);

  await moveToTrash(page, b, isMobile);
  await Promise.all([
    page.waitForResponse((reply) => /\/restore$/.test(reply.url()) && reply.ok()),
    undoOffer(page).getByRole('button', { name: 'Undo' }).click(),
  ]);

  await expect.poll(order).toEqual([a, b, c]);
  await page.reload();
  await expect.poll(order).toEqual([a, b, c]);
});

test('Delete on the focused row moves it to the trash', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a phone has no Delete key');
  const { a, b, c, order } = await threeTasks(page);

  await rowNamed(page, b).getByRole('link', { name: b }).focus();
  await page.keyboard.press('Delete');

  await expect(undoOffer(page)).toBeVisible();
  await expect.poll(order).toEqual([a, c]);
  await expect(page).toHaveURL(/\/tasks$/);
});

test('Delete forever and Empty trash are permanent, after the dialog', async ({ page }) => {
  const { a, b, c } = await threeTasks(page);
  for (const id of created) await page.request.delete(`/api/tasks/${id}`);

  await page.goto('/trash');
  const trashed = page.getByRole('list', { name: 'Trashed tasks' });
  await expect(trashed.getByRole('link', { name: new RegExp(a) })).toBeVisible();

  await trashed.getByRole('button', { name: `Delete “${b}” forever` }).click();
  const forever = page.getByRole('dialog', { name: 'Delete this task forever?' });
  await forever.getByRole('button', { name: 'Delete forever' }).click();
  await expect(forever).toHaveCount(0);
  await expect(trashed.getByRole('link', { name: new RegExp(b) })).toHaveCount(0);
  await expect(trashed.getByRole('link', { name: new RegExp(c) })).toBeVisible();

  await page.getByRole('button', { name: 'Empty trash' }).click();
  const empty = page.getByRole('dialog', { name: 'Empty Trash?' });
  await empty.getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();

  const left = TrashList.parse(await (await page.request.get('/api/trash')).json());
  expect(left.items).toEqual([]);
  await page.goto(`/tasks?q=${encodeURIComponent(a)}`);
  await expect(page.getByRole('listitem', { name: a })).toHaveCount(0);
});

test('on a phone, a swipe to the right moves the task to the trash, and Undo brings it back', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'swipe gestures are the phone tier');
  const { a, b, c, order } = await threeTasks(page);
  const row = rowNamed(page, b);
  const box = await row.boundingBox();
  if (box === null) throw new Error('no row box');
  const [x, y] = [box.x + box.width / 2 - 60, box.y + box.height / 2];
  // Real touch events through the DevTools protocol, so the browser's scroll handling takes part.
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: at, y }],
    });

  await touch('touchStart', x);
  for (let step = 1; step <= 6; step += 1) await touch('touchMove', x + step * 20);
  // Armed: the Complete underlay's twin, in red, saying Release; the release is announced.
  const underlay = row.locator('[data-armed]');
  await expect(underlay).toHaveAttribute('data-action', 'delete');
  await expect(underlay).toHaveAttribute('data-armed', 'true');
  await expect(underlay).toHaveText('Release');
  await expect(page.getByText('Release to delete task.')).toBeAttached();
  await touch('touchEnd', x + 120);

  await expect(undoOffer(page)).toBeVisible();
  await expect(rowNamed(page, b)).toHaveCount(0);
  await expect.poll(order).toEqual([a, c]);
  expect(await page.getByRole('dialog').count()).toBe(0);

  await Promise.all([
    page.waitForResponse((reply) => /\/restore$/.test(reply.url()) && reply.ok()),
    undoOffer(page).getByRole('button', { name: 'Undo' }).click(),
  ]);
  await expect.poll(order).toEqual([a, b, c]);
  await page.reload();
  await expect.poll(order).toEqual([a, b, c]);
});

import { expect, test, type Page } from '@playwright/test';
import { TaskList } from '@todo/contracts';

// Reordering must save exactly what the user sees when they let go: the open rows' on-screen

const COUNT = 25;

const signUpWithTasks = async (page: Page) => {
  const stamp = String(Date.now());
  const email = `reorder+${stamp}@example.com`;
  const signUp = await page.request.post('/api/auth/signup', {
    data: { email, password: 'review-1234', confirmPassword: 'review-1234' },
  });
  expect(signUp.ok()).toBe(true);

  for (let n = COUNT; n >= 1; n -= 1) {
    const response = await page.request.post('/api/tasks', {
      data: { title: `T${String(n).padStart(2, '0')} ${stamp}` },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/tasks');
  await expect(page.getByRole('list', { name: 'Open tasks' }).getByRole('listitem')).toHaveCount(
    COUNT,
  );
};

const visualOrder = (page: Page) =>
  page
    .getByRole('list', { name: 'Open tasks' })
    .getByRole('listitem')
    .evaluateAll((items) =>
      items
        .map((item) => ({
          name: item.getAttribute('aria-label') ?? '',
          top: item.getBoundingClientRect().top,
        }))
        .sort((a, b) => a.top - b.top)
        .map(({ name }) => name),
    );

const serverOrder = async (page: Page) => {
  const response = await page.request.get('/api/tasks');
  return TaskList.parse(await response.json())
    .items.filter((task) => task.status === 'todo')
    .map((task) => task.title);
};

const rowCentre = async (page: Page, index: number) => {
  const box = await page
    .getByRole('list', { name: 'Open tasks' })
    .getByRole('listitem')
    .nth(index)
    .boundingBox();
  if (box === null) throw new Error(`no row ${String(index)}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const dragGrip = async (
  page: Page,
  from: number,
  to: { x: number; y: number },
  { dwell = 0 }: { dwell?: number } = {},
) => {
  const grip = await page
    .getByRole('list', { name: 'Open tasks' })
    .getByRole('listitem')
    .nth(from)
    .getByRole('button', { name: /^Reorder / })
    .boundingBox();
  if (grip === null) throw new Error('no grip');
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(start.x, start.y + ((to.y - start.y) * step) / 20);
  }

  if (dwell > 0) await page.waitForTimeout(dwell);
  await page.mouse.move(start.x, to.y + 1);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  const seen = await visualOrder(page);
  await page.mouse.up();
  return seen;
};

test.describe('reorder saves what the user sees', () => {
  test('a short drag down', async ({ page }) => {
    await signUpWithTasks(page);
    const seen = await dragGrip(page, 1, await rowCentre(page, 5));
    await expect.poll(() => serverOrder(page)).toEqual(seen);
  });

  test('a short drag up', async ({ page }) => {
    await signUpWithTasks(page);
    const seen = await dragGrip(page, 7, await rowCentre(page, 2));
    await expect.poll(() => serverOrder(page)).toEqual(seen);
  });

  test('a drag inside a list scrolled down', async ({ page }) => {
    await signUpWithTasks(page);
    await page.locator('.masterBody').evaluate((node) => {
      node.scrollTop = 400;
    });
    const rows = page.getByRole('list', { name: 'Open tasks' }).getByRole('listitem');
    const visible = await rows.evaluateAll((items) => {
      const body = document.querySelector('.masterBody')?.getBoundingClientRect();
      return items.flatMap((item, index) => {
        const box = item.getBoundingClientRect();
        return body !== undefined && box.top >= body.top && box.bottom <= body.bottom
          ? [index]
          : [];
      });
    });
    const from = visible[1] ?? 0;
    const to = visible[visible.length - 2] ?? 0;
    const seen = await dragGrip(page, from, await rowCentre(page, to));
    await expect.poll(() => serverOrder(page)).toEqual(seen);
  });

  test('a drag that auto-scrolls the list', async ({ page }) => {
    await signUpWithTasks(page);
    const body = await page.locator('.masterBody').boundingBox();
    if (body === null) throw new Error('no body');
    const seen = await dragGrip(
      page,
      1,
      { x: body.x + body.width / 2, y: body.y + body.height - 8 },
      { dwell: 1200 },
    );
    await expect.poll(() => serverOrder(page)).toEqual(seen);
  });

  test('a drag up that auto-scrolls the list back up (it lands higher in the list)', async ({
    page,
  }) => {
    await signUpWithTasks(page);
    const body = page.locator('.masterBody');
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const box = await body.boundingBox();
    if (box === null) throw new Error('no body');
    const last = COUNT - 2;
    const seen = await dragGrip(
      page,
      last,
      { x: box.x + box.width / 2, y: box.y + 8 },
      { dwell: 1200 },
    );
    await expect.poll(() => serverOrder(page)).toEqual(seen);
  });
});

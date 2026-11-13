import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { Task } from '@todo/contracts';
import { storageStateFor } from './support';

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

const threeTasks = async (page: Page) => {
  const stamp = String(Date.now());
  const [a, b, c] = [`A ${stamp}`, `B ${stamp}`, `C ${stamp}`];
  const ids: Record<string, string> = {};
  for (const title of [c, b, a]) {
    const response = await page.request.post('/api/tasks', { data: { title } });
    expect(response.ok()).toBe(true);
    const task = Task.parse(await response.json());
    created.push(task.id);
    ids[title] = task.id;
  }
  await page.goto('/tasks');
  await expect(rowNamed(page, a)).toBeVisible();
  const order = async () => {
    const names = await openList(page)
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label') ?? ''));
    return names.filter((name) => name.endsWith(stamp));
  };
  return { a, b, c, ids, order };
};

const centre = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('no box');
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const expectSaved = async (page: Page, order: () => Promise<string[]>, expected: string[]) => {
  await expect.poll(order).toEqual(expected);
  await page.reload();
  await expect.poll(order).toEqual(expected);
};

test.describe('a fine pointer', () => {
  test.skip(({ isMobile }) => isMobile, 'the phone has its own gestures below');

  test('a click on the empty right side of a row opens the task', async ({ page }) => {
    const { a, ids } = await threeTasks(page);
    const { box, y } = await centre(rowNamed(page, a));

    await page.mouse.click(box.x + box.width - 24, y);

    await expect(page).toHaveURL(new RegExp(`/tasks/${ids[a] ?? ''}`));
  });

  test('every blank part of a row and its metadata open the task; its controls do not', async ({
    page,
  }) => {
    const title = `Meta ${String(Date.now())}`;
    const response = await page.request.post('/api/tasks', {
      data: { title, priority: 'high', dueDate: '2030-01-15' },
    });
    const task = Task.parse(await response.json());
    created.push(task.id);
    await page.goto('/tasks');
    const row = rowNamed(page, title);
    const { box, y } = await centre(row);
    const opened = new RegExp(`/tasks/${task.id}`);
    const back = async () => {
      await page.goto('/tasks');
      await expect(row).toBeVisible();
    };

    for (const x of [box.x + box.width * 0.5, box.x + box.width - 24]) {
      await page.mouse.click(x, y);
      await expect(page).toHaveURL(opened);
      await back();
    }

    for (const meta of [row.getByText('High'), row.getByText(/Jan 15/)]) {
      const spot = await centre(meta);
      await page.mouse.click(spot.x, spot.y);
      await expect(page).toHaveURL(opened);
      await back();
    }

    await row.getByRole('button', { name: `Reorder ${title}` }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await Promise.all([
      page.waitForResponse((reply) => reply.request().method() === 'PATCH'),
      row.getByRole('checkbox').click(),
    ]);
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('releasing a drag outside the list cancels it', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const from = await centre(rowNamed(page, a).getByRole('link', { name: a }));
    const to = await centre(rowNamed(page, c));

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) {
      await page.mouse.move(from.x, from.y + ((to.y - from.y) * step) / 5);
    }

    for (let step = 1; step <= 5; step += 1) await page.mouse.move(from.x + step * 160, to.y);
    await page.mouse.up();

    await expect(rowNamed(page, a).locator('[data-dragging]')).toHaveAttribute(
      'data-dragging',
      'false',
    );
    expect(await order()).toEqual([a, b, c]);
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('releasing over the footer below a long list cancels the drag', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const from = await centre(rowNamed(page, a).getByRole('link', { name: a }));
    const viewport = page.viewportSize();
    if (viewport === null) throw new Error('no viewport');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();

    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(from.x, from.y + ((viewport.height - 12 - from.y) * step) / 10);
    }
    await page.mouse.up();

    await expect(rowNamed(page, a).locator('[data-dragging]')).toHaveAttribute(
      'data-dragging',
      'false',
    );
    expect(await order()).toEqual([a, b, c]);
  });

  test('a short list keeps the dragged row inside it, readable', async ({ page }) => {
    const email = `short-list+${String(Date.now())}@example.com`;
    const signUp = await page.request.post('/api/auth/signup', {
      data: { email, password: 'review-1234', confirmPassword: 'review-1234' },
    });
    expect(signUp.ok()).toBe(true);
    const { a } = await threeTasks(page);
    const list = await openList(page).boundingBox();
    if (list === null) throw new Error('no list box');
    const from = await centre(rowNamed(page, a).getByRole('link', { name: a }));

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(from.x, from.y + step * 50);
    const dragged = rowNamed(page, a).locator('[data-dragging="true"]');
    const box = await dragged.boundingBox();
    if (box === null) throw new Error('no dragged box');
    expect(box.y + box.height).toBeLessThanOrEqual(list.y + list.height + 1);
    expect(Number(await dragged.evaluate((node) => getComputedStyle(node).opacity))).toBe(1);

    const title = await rowNamed(page, a).getByRole('link', { name: a }).boundingBox();
    if (title === null) throw new Error('no title box');
    const hit = await page.evaluate(
      ({ x, y, name }) =>
        document.elementFromPoint(x, y)?.closest('li')?.getAttribute('aria-label') === name,
      { x: title.x + 8, y: title.y + 3, name: a },
    );
    expect(hit).toBe(true);
    await page.mouse.up();
  });

  test('dragging a grip sideways never scrolls or clips the list', async ({ page }) => {
    const { a } = await threeTasks(page);
    const grip = await centre(rowNamed(page, a).getByRole('button', { name: `Reorder ${a}` }));
    const body = page.locator('.masterBody');

    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(grip.x + step * 100, grip.y);
    expect(await body.evaluate((node) => node.scrollLeft)).toBe(0);
    const shiftX = await rowNamed(page, a).evaluate((node) => {
      const transform = getComputedStyle(node).transform;
      return new DOMMatrix(transform === 'none' ? undefined : transform).m41;
    });
    expect(shiftX).toBe(0);
    await page.mouse.up();

    expect(await body.evaluate((node) => node.scrollLeft)).toBe(0);
  });

  test('a click on the title without movement opens the task', async ({ page }) => {
    const { a, ids } = await threeTasks(page);

    await rowNamed(page, a).getByRole('link', { name: a }).click();

    await expect(page).toHaveURL(new RegExp(`/tasks/${ids[a] ?? ''}`));
  });

  test('dragging a task by its title reorders it, and the order is saved', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const from = await centre(rowNamed(page, a).getByRole('link', { name: a }));
    const to = await centre(rowNamed(page, c));

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(from.x, from.y + ((to.y - from.y + 8) * step) / 10);
    }
    await page.mouse.up();

    await expectSaved(page, order, [b, c, a]);
    await expect(page).toHaveURL(/\/tasks$/);
  });
});

const finger = async (page: Page) => {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  return {
    down: (x: number, y: number) => send('touchStart', x, y),
    move: (x: number, y: number) => send('touchMove', x, y),
    up: (x: number, y: number) => send('touchEnd', x, y),
  };
};

test.describe('a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch gestures are the phone tier');

  test('a tap on the empty right side of a row opens the task', async ({ page }) => {
    const { a, ids } = await threeTasks(page);
    const { box, y } = await centre(rowNamed(page, a));

    await page.touchscreen.tap(box.x + box.width - 72, y);

    await expect(page).toHaveURL(new RegExp(`/tasks/${ids[a] ?? ''}`));
  });

  test('a quick vertical pan over a row scrolls and never drags', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const { x, y } = await centre(rowNamed(page, a));
    const touch = await finger(page);

    await touch.down(x, y);
    for (let step = 1; step <= 8; step += 1) await touch.move(x, y + step * 15);
    await touch.up(x, y + 120);

    await expect(rowNamed(page, a).locator('[data-dragging]')).toHaveAttribute(
      'data-dragging',
      'false',
    );
    expect(await order()).toEqual([a, b, c]);
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test('holding a row for 450ms, then moving, drags it; the order is saved', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const from = await centre(rowNamed(page, a));
    const to = await centre(rowNamed(page, c));
    const touch = await finger(page);

    await touch.down(from.x, from.y);
    await expect(rowNamed(page, a).locator('[data-held]')).toHaveAttribute('data-held', 'true');
    for (let step = 1; step <= 10; step += 1) {
      await touch.move(from.x, from.y + ((to.y - from.y + 8) * step) / 10);
    }
    await touch.up(from.x, to.y + 8);

    await expectSaved(page, order, [b, c, a]);
    await expect(page.getByRole('button', { name: 'Task options' }).first()).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('holding a row and lifting without moving opens its options', async ({ page }) => {
    const { a } = await threeTasks(page);
    const { x, y } = await centre(rowNamed(page, a));
    const touch = await finger(page);

    await touch.down(x, y);
    await expect(rowNamed(page, a).locator('[data-held]')).toHaveAttribute('data-held', 'true');
    await touch.up(x, y);

    await expect(rowNamed(page, a).getByRole('button', { name: 'Task options' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('a horizontal swipe to the left still completes the task', async ({ page }) => {
    const { a, b, c, order } = await threeTasks(page);
    const { x, y } = await centre(rowNamed(page, a));
    const touch = await finger(page);

    await touch.down(x, y);
    for (let step = 1; step <= 8; step += 1) await touch.move(x - step * 20, y);
    await touch.up(x - 160, y);

    await expect.poll(order).toEqual([b, c]);
  });
});

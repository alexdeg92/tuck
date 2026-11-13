import { expect, test, type Page } from '@playwright/test';
import { Task } from '@todo/contracts';
import { storageStateFor } from './support';

test.use({ storageState: storageStateFor('demo') });
test.skip(({ isMobile }) => !isMobile, 'the note bar is the phone tier');

const box = async (page: Page, name: string, role: 'link' | 'button') => {
  const found = await page.getByRole('banner').first().getByRole(role, { name }).boundingBox();
  if (!found) throw new Error(`${name} has no box`);
  return found;
};

for (const width of [390, 344]) {
  test(`at ${String(width)} px the note sits right under one 56 px bar, and still autosaves`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const task = Task.parse(
      await (
        await page.request.post('/api/tasks', { data: { title: `Bar ${String(Date.now())}` } })
      ).json(),
    );
    await page.goto(`/tasks/${task.id}`);
    const notes = page.getByRole('textbox', { name: 'Notes' });
    await expect(notes).toBeVisible();

    const bar = await page.getByRole('banner').first().boundingBox();
    const region = await page.getByRole('region', { name: 'Task notes' }).boundingBox();
    expect(bar).not.toBeNull();
    expect(region).not.toBeNull();
    if (!bar || !region) return;
    expect(Math.round(bar.height)).toBe(56);
    expect(Math.abs(region.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
    for (const [name, role] of [
      ['Back to tasks', 'link'],
      ['Task settings', 'button'],
      ['App menu', 'button'],
    ] as const) {
      const control = await box(page, name, role);
      expect.soft(control.height, `${name} height`).toBeGreaterThanOrEqual(44);
      expect.soft(control.width, `${name} width`).toBeGreaterThanOrEqual(44);
    }

    await expect(
      page
        .getByRole('banner')
        .first()
        .getByRole('button', { name: 'Task settings' })
        .getByText('Task settings'),
    ).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );

    await notes.fill('Typed under the bar.');
    await expect(
      page.getByRole('banner').first().getByText('Saved', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(notes).toHaveValue('Typed under the bar.');

    await page.getByRole('button', { name: 'App menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.screenshot({ path: `test-results/note-bar-${String(width)}.png` });

    await page.request.delete(`/api/tasks/${task.id}`);
  });
}

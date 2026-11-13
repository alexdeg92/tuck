import { expect, test } from '@playwright/test';

test('a signed-in user manages a task from creation to deletion', async ({ page }) => {
  const title = `E2E task ${String(Date.now())}`;
  const editedTitle = `${title} (edited)`;
  const rows = page.getByRole('listitem');

  await test.step('sign in as the demo user', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin$/);
    await page.getByRole('textbox', { name: 'Email' }).fill('demo@example.com');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(rows.first()).toBeVisible();
  });

  await test.step('create a task, which lands at the top', async () => {
    await page.getByRole('button', { name: 'New task' }).click();
    const newTask = page.getByRole('textbox', { name: 'New task' });
    await expect(newTask).toBeFocused();
    await expect(page.getByRole('button', { name: /New task priority/ })).toHaveText('Medium');
    await newTask.fill(title);
    await newTask.press('Enter');
    await expect(rows.first()).toHaveAccessibleName(title);
  });

  await test.step('search narrows the list and turns reordering off', async () => {
    const search = page.getByRole('searchbox', { name: 'Search tasks' });
    await search.fill(title);
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Reorder ${title}` })).toBeDisabled();
    await search.fill('');
    await expect(rows.nth(1)).toBeVisible();
  });

  await test.step('reorder by keyboard, and the new order survives a reload', async () => {
    const handle = page.getByRole('button', { name: `Reorder ${title}` });
    await handle.focus();
    await page.keyboard.press('Space');

    await expect(handle).toHaveAttribute('aria-pressed', 'true');

    // delay run in order), so the single ArrowDown below can't be lost. No sleep, no retry.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        }),
    );
    await page.keyboard.press('ArrowDown');

    await expect(page.getByRole('status')).toContainText(`${title} moved to position 2 of`);

    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/move') &&
          response.ok(),
      ),
      page.keyboard.press('Space'),
    ]);
    await expect(page.getByRole('status')).toContainText(`${title} dropped at position 2 of`);
    await expect(rows.nth(1)).toHaveAccessibleName(title);
    await page.reload();
    await expect(rows.nth(1)).toHaveAccessibleName(title);
  });

  await test.step('open the detail page, edit the task and mark it done', async () => {
    await page.getByRole('link', { name: title }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
    await page.getByRole('textbox', { name: 'Title' }).fill(editedTitle);
    await page.getByRole('textbox', { name: 'Notes' }).fill('Written by the end-to-end test.');
    await page.getByRole('button', { name: 'Task settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Task settings' });

    await settings.getByRole('button', { name: /Priority/ }).click();
    await page.getByRole('option', { name: 'High' }).click();

    await settings.getByRole('group', { name: 'Due date' }).getByRole('spinbutton').first().click();
    await page.keyboard.type('01312030');
    await settings.getByRole('checkbox', { name: 'Mark as done' }).check();

    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(editedTitle);
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveValue(
      'Written by the end-to-end test.',
    );
    await page.getByRole('button', { name: 'Task settings' }).click();
    const settingsAgain = page.getByRole('dialog', { name: 'Task settings' });
    await expect(settingsAgain.getByRole('button', { name: /Priority/ })).toHaveText('High');
    await expect(
      settingsAgain.getByRole('group', { name: 'Due date' }).getByRole('spinbutton'),
    ).toHaveText(['1', '31', '2030']);
    await expect(settingsAgain.getByRole('checkbox', { name: 'Mark as done' })).toBeChecked();
  });

  await test.step('move the task to the trash, with no confirmation', async () => {
    // Settings is still open after the reload checks; Move to trash is inside it.
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('listitem', { name: editedTitle })).toHaveCount(0);
    await page.reload();
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole('listitem', { name: editedTitle })).toHaveCount(0);
  });

  await test.step('sign out, and the session is really gone', async () => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/signin$/);
  });
});

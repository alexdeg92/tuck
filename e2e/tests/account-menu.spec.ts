import { expect, test } from '@playwright/test';
import { demo, storageStateFor } from './support';

// The Account menu is the app bar's last item and the one place to sign out: its trigger sits at
// the bar's right edge, and its list opens under it, right edges aligned, inside the viewport.
// Each project runs this at its own viewport (1440x900 and 390x844).

test.use({ storageState: storageStateFor('demo') });

test('one Account menu at the right of the app bar, opening under it inside the viewport', async ({
  page,
  isMobile,
}) => {
  await page.goto('/tasks');
  const bar = page.getByRole('banner').first();
  const trigger = bar.getByRole('button', { name: /Account menu/ });
  await expect(trigger).toBeVisible();

  // No Sign out outside the menu.
  await expect(page.getByRole('button', { name: /Sign out/ })).toHaveCount(0);

  const barBox = await bar.boundingBox();
  const triggerBox = await trigger.boundingBox();
  if (!barBox || !triggerBox) throw new Error('the app bar or its Account menu has no box');
  // The last thing in the bar: nothing of the bar's sits to its right.
  const rightmost = await bar.evaluate((header) =>
    Math.max(
      ...[...header.querySelectorAll('button, a')]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.getBoundingClientRect().right),
    ),
  );
  expect(Math.round(triggerBox.x + triggerBox.width)).toBe(Math.round(rightmost));
  expect(barBox.x + barBox.width - (triggerBox.x + triggerBox.width)).toBeLessThanOrEqual(24);

  // The email shows in the trigger beside a phone, and in the menu only on a phone.
  await expect(trigger.getByText(demo.email)).toBeVisible({ visible: !isMobile });

  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText(demo.email)).toBeVisible({ visible: isMobile });
  await expect(menu.getByRole('menuitem')).toHaveText(['Sign out', 'Sign out everywhere']);
  await expect(menu.getByRole('separator')).toHaveCount(1);

  // Measured where it rests, after its enter motion.
  await menu.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  );
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('the Account menu has no box');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  expect(Math.abs(menuBox.x + menuBox.width - (triggerBox.x + triggerBox.width))).toBeLessThan(1);
  expect(menuBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height);
  expect(menuBox.y - (triggerBox.y + triggerBox.height)).toBeLessThanOrEqual(8);
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

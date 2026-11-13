import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openScreen, screens, storageStateFor } from './support';

// It fails on serious and critical violations; manual checks still cover what axe can't see.

for (const screen of screens) {
  test.describe(screen.name, () => {
    test.use({ storageState: storageStateFor(screen.session) });

    test('has no serious or critical accessibility violations', async ({ page }) => {
      await openScreen(page, screen);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map(
          (violation) =>
            `${violation.id}: ${violation.help} (${String(violation.nodes.length)} nodes)`,
        );
      expect(blocking).toEqual([]);
    });
  });
}

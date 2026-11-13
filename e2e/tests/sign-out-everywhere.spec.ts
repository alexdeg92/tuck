import { expect, test, type Browser, type Page } from '@playwright/test';

// Sign out everywhere ends the account's sessions on every device: two browser contexts are two
// devices. A fresh account each run, so the demo session the other specs share stays signed in.
// Each device signs in through its own API request (one auth call each: sign-ins are
// rate-limited per client, and the whole suite shares that budget, so this spec keeps to two).
// A revoked device's next action landing on sign-in (any 401) is covered by the web unit tests.

/** The web app's SESSION_RECHECK_INTERVAL_MS (apps/web/src/features/auth/useSessionWatch.ts). */
const SESSION_RECHECK_INTERVAL_MS = 30_000;

type Account = { email: string; password: string };

const freshAccount = (): Account => ({
  email: `everywhere-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`,
  password: 'everywhere-pass',
});

/**
 * A new device (its own cookie jar), signed in, showing its task list. `clock`: the page runs on
 * Playwright's controllable clock (installed before the app loads), so a test can jump to the
 * next session re-check instead of waiting for it.
 */
const newDevice = async (
  browser: Browser,
  account: Account,
  signIn: 'signup' | 'login',
  { clock = false }: { clock?: boolean } = {},
): Promise<Page> => {
  const context = await browser.newContext();
  const response =
    signIn === 'signup'
      ? await context.request.post('/api/auth/signup', {
          data: { ...account, confirmPassword: account.password },
        })
      : await context.request.post('/api/auth/login', { data: account });
  expect(response.ok()).toBe(true);
  const page = await context.newPage();
  if (clock) await page.clock.install();
  await page.goto('/tasks');
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
  return page;
};

/** Marks the loaded document, so a test can prove a page reached sign-in without a reload. */
const markDocument = (page: Page) =>
  page.evaluate(() => {
    (window as Window & { notReloaded?: boolean }).notReloaded = true;
  });
const stillSameDocument = (page: Page) =>
  page.evaluate(() => (window as Window & { notReloaded?: boolean }).notReloaded === true);

/** Opens the Account menu and chooses Sign out everywhere. */
const signOutEverywhere = async (page: Page) => {
  const trigger = page.getByRole('button', { name: 'Account menu' });
  await expect(page.getByRole('button', { name: 'Sign out everywhere' })).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Sign out everywhere' }).click();
};

test('signing out everywhere sends the other devices to sign-in at the next re-check, and the browser’s other tabs at once', async ({
  browser,
}) => {
  const account = freshAccount();
  const laptop = await newDevice(browser, account, 'signup', { clock: true });
  const phone = await newDevice(browser, account, 'login');
  // A second tab on the phone: same browser, same cookie.
  const phoneTab = await phone.context().newPage();
  await phoneTab.goto('/tasks');
  await expect(phoneTab.getByRole('button', { name: 'New task' })).toBeVisible();
  await markDocument(laptop);
  await markDocument(phoneTab);

  const started = Date.now();
  await test.step('sign out everywhere from the phone’s Account menu', async () => {
    await signOutEverywhere(phone);
    await expect(phone).toHaveURL(/\/signin$/);
  });

  await test.step('the phone’s other tab is on sign-in at once, without a reload', async () => {
    // Well inside one re-check interval: only the tab-to-tab message is this fast.
    await expect(phoneTab).toHaveURL(/\/signin$/, { timeout: 3_000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(SESSION_RECHECK_INTERVAL_MS);
    test.info().annotations.push({
      type: 'other tab on sign-in after',
      description: `${String(elapsed)} ms`,
    });
    expect(await stillSameDocument(phoneTab)).toBe(true);
  });

  await test.step('the idle laptop goes to sign-in on its own at the next re-check, without a reload', async () => {
    await expect(laptop.getByRole('button', { name: 'New task' })).toBeVisible();
    await laptop.clock.fastForward(SESSION_RECHECK_INTERVAL_MS);
    await expect(laptop).toHaveURL(/\/signin$/, { timeout: 5_000 });
    await expect(laptop.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(await stillSameDocument(laptop)).toBe(true);
  });

  await laptop.context().close();
  await phone.context().close();
});

import { expect, test, type Page } from '@playwright/test';

const fillSignUp = async (
  page: Page,
  { email, password, confirmation }: { email: string; password: string; confirmation: string },
): Promise<void> => {
  await page.goto('/signin');
  await page.getByRole('link', { name: 'Create an account' }).click();

  await expect(page.getByLabel('Confirm password')).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(confirmation);
  await page.getByRole('button', { name: 'Sign up' }).click();
};

const freshEmail = (label: string): string =>
  `${label}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}@example.com`;

test('a new account with a matching confirmation lands on its empty task list', async ({
  page,
}) => {
  await fillSignUp(page, {
    email: freshEmail('new'),
    password: 'a-new-password',
    confirmation: 'a-new-password',
  });
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible();
});

test('a confirmation that does not match is flagged on its field', async ({ page }) => {
  await fillSignUp(page, {
    email: freshEmail('mismatch'),
    password: 'a-new-password',
    confirmation: 'another-password',
  });
  await expect(page.getByLabel('Confirm password')).toHaveAccessibleDescription(
    "Passwords don't match",
  );
  await expect(page).toHaveURL(/\/signup$/);
});

test('an address that already has an account says so', async ({ page }) => {
  await fillSignUp(page, {
    email: 'demo@example.com',
    password: 'a-new-password',
    confirmation: 'a-new-password',
  });
  await expect(page.getByText('An account with this email already exists.')).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { Task } from '@todo/contracts';
import { storageStateFor } from './support';

test.use({ storageState: storageStateFor('demo') });

const created: string[] = [];

async function createTask(request: APIRequestContext, title: string): Promise<Task> {
  const response = await request.post('/api/tasks', { data: { title, notes: '' } });
  expect(response.status()).toBe(201);
  const task = Task.parse(await response.json());
  created.push(task.id);
  return task;
}

const notes = (page: Page) => page.getByRole('textbox', { name: 'Notes' });
const saved = (page: Page) => page.getByText('Saved', { exact: true });

test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) await request.delete(`/api/tasks/${id}`);
});

test('typed notes are saved without clicking anything and survive a reload', async ({ page }) => {
  const task = await createTask(page.request, `Autosave ${String(Date.now())}`);
  await page.goto(`/tasks/${task.id}`);

  await notes(page).pressSequentially('Saved by typing.');
  await expect(page.getByText('Editing…', { exact: true })).toBeVisible();
  await expect(saved(page)).toBeVisible();

  await page.reload();
  await expect(notes(page)).toHaveValue('Saved by typing.');
});

test('switching task mid-typing saves both tasks', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the phone shows one pane at a time; switching is a desktop gesture');
  const stamp = String(Date.now());
  const first = await createTask(page.request, `First ${stamp}`);
  const second = await createTask(page.request, `Second ${stamp}`);
  await page.goto(`/tasks/${first.id}`);

  await notes(page).pressSequentially('first notes');
  await page.getByRole('link', { name: second.title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(second.title);
  await notes(page).pressSequentially('second notes');
  await expect(saved(page)).toBeVisible();

  await expect
    .poll(
      async () => Task.parse(await (await page.request.get(`/api/tasks/${first.id}`)).json()).notes,
    )
    .toBe('first notes');
  await page.reload();
  await expect(notes(page)).toHaveValue('second notes');
});

test('two tabs: the second edit asks Keep mine or Use theirs', async ({ page, context }) => {
  const task = await createTask(page.request, `Two tabs ${String(Date.now())}`);
  const other = await context.newPage();
  await page.goto(`/tasks/${task.id}`);
  await other.goto(`/tasks/${task.id}`);
  await expect(notes(other)).toHaveValue('');

  await notes(page).fill('Written in tab one.');
  await notes(page).blur();
  await expect(saved(page)).toBeVisible();

  await notes(other).fill('Written in tab two.');
  await notes(other).blur();
  const choice = other.getByRole('alert');
  await expect(choice).toContainText('This note changed elsewhere.');

  await choice.getByRole('button', { name: 'Use theirs' }).click();
  await expect(notes(other)).toHaveValue('Written in tab one.');
  await expect(saved(other)).toBeVisible();

  await notes(other).fill('Tab two again.');
  await notes(other).blur();
  await expect(saved(other)).toBeVisible();
  await notes(page).fill('Tab one keeps its own.');
  await notes(page).blur();
  await page.getByRole('alert').getByRole('button', { name: 'Keep mine' }).click();
  await expect(saved(page)).toBeVisible();
  await expect
    .poll(
      async () => Task.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json()).notes,
    )
    .toBe('Tab one keeps its own.');
});

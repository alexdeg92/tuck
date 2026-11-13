import { expect, test } from '@playwright/test';
import { Task } from '@todo/contracts';
import { storageStateFor } from './support';

// retried automatically (a lost reply must never apply a change twice): the tick rolls back with

test.use({ storageState: storageStateFor('demo') });

test('a tick refused once by the proxy shows a friendly error, never applies twice, and sticks on retry', async ({
  page,
}) => {
  const created = Task.parse(
    await (
      await page.request.post('/api/tasks', { data: { title: `Hiccup ${String(Date.now())}` } })
    ).json(),
  );
  await page.goto('/tasks');
  const box = page.getByRole('checkbox', { name: `Mark ${created.title} as done` });
  await expect(box).toBeVisible();

  let patches = 0;
  await page.route(`**/api/tasks/${created.id}`, (route) => {
    if (route.request().method() === 'PATCH') {
      patches += 1;
      if (patches === 1)
        return route.fulfill({ status: 502, contentType: 'text/plain', body: 'Bad Gateway' });
    }
    return route.fallback();
  });

  await box.click();

  await expect.poll(() => patches).toBe(1);
  await expect(page.getByText(/not valid JSON|Bad Gateway|Unexpected token/)).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(patches).toBe(1);
  expect(Task.parse(await (await page.request.get(`/api/tasks/${created.id}`)).json()).status).toBe(
    'todo',
  );

  await page.getByRole('checkbox', { name: `Mark ${created.title} as done` }).click();
  await expect
    .poll(
      async () =>
        Task.parse(await (await page.request.get(`/api/tasks/${created.id}`)).json()).status,
    )
    .toBe('done');

  await page.request.delete(`/api/tasks/${created.id}`);
});

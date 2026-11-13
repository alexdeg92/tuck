import { expect, test as setup } from '@playwright/test';
import { demo, sessionPath } from './support';

setup('sign in the demo user', async ({ request }) => {
  const response = await request.post('/api/auth/login', { data: demo });
  expect(response.status()).toBe(200);
  await request.storageState({ path: sessionPath('demo') });
});

setup('create a user with a long task list', async ({ request }) => {
  const credentials = {
    email: `long-list-${String(Date.now())}@example.com`,
    password: 'long-list-pass',
  };
  const signUp = await request.post('/api/auth/signup', {
    data: { ...credentials, confirmPassword: credentials.password },
  });
  expect(signUp.status()).toBe(201);

  for (const n of Array.from({ length: 30 }, (_, index) => index + 1)) {
    const created = await request.post('/api/tasks', {
      data: { title: `Long list task ${String(n)}`, notes: 'Fills the list so that it scrolls.' },
    });
    expect(created.status()).toBe(201);
  }
  await request.storageState({ path: sessionPath('long') });
});

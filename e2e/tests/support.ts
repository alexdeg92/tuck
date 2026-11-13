import { expect, type Locator, type Page } from '@playwright/test';
import { TaskList } from '@todo/contracts';

export type Session = 'none' | 'demo' | 'long';

export type Screen = {
  name: string;
  session: Session;
  path: string;
  ready: (page: Page) => Locator;
  longContent?: boolean;
};

export const demo = { email: 'demo@example.com', password: 'demo1234' };

type StorageState = string | { cookies: []; origins: [] };

const signedOut: StorageState = { cookies: [], origins: [] };

export const sessionPath = (session: Exclude<Session, 'none'>): string =>
  `${import.meta.dirname}/../test-results/.auth/${session}.json`;

export const storageStateFor = (session: Session): StorageState =>
  session === 'none' ? signedOut : sessionPath(session);

export const screens: Screen[] = [
  {
    name: 'sign in',
    session: 'none',
    path: '/signin',
    ready: (page) => page.getByRole('button', { name: 'Sign in' }),
  },
  {
    name: 'sign up',
    session: 'none',
    path: '/signup',
    ready: (page) => page.getByRole('textbox', { name: 'Email' }),
  },
  {
    name: 'task list',
    session: 'demo',
    path: '/tasks',
    ready: (page) => page.getByRole('listitem').first(),
  },
  {
    name: 'long task list',
    session: 'long',
    path: '/tasks',
    ready: (page) => page.getByRole('listitem').first(),
    longContent: true,
  },
  {
    name: 'no search results',
    session: 'demo',
    path: '/tasks?q=zzz',
    ready: (page) => page.getByRole('searchbox', { name: 'Search tasks' }),
  },
  {
    name: 'task detail',
    session: 'demo',
    path: '/tasks/:firstTaskId',
    ready: (page) => page.getByRole('textbox', { name: 'Title' }),
  },
];

export const openScreen = async (page: Page, screen: Screen): Promise<void> => {
  const path = screen.path.includes(':firstTaskId')
    ? screen.path.replace(':firstTaskId', await firstTaskId(page))
    : screen.path;
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(screen.ready(page)).toBeVisible();
};

const firstTaskId = async (page: Page): Promise<string> => {
  const response = await page.request.get('/api/tasks');
  expect(response.ok()).toBe(true);
  const { items } = TaskList.parse(await response.json());
  const first = items[0];
  if (first === undefined) throw new Error('The signed-in user has no tasks to open');
  return first.id;
};

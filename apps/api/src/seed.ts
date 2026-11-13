import type { Credentials } from '@todo/contracts';
import { type DemoTask, DEMO_TASKS } from './demoContent';
import {
  makeSignUp,
  type PasswordHasher,
  type TokenIssuer,
  type UserRepository,
} from './modules/auth/application';
import {
  type ChecklistRepository,
  makeAddChecklistItem,
  makeUpdateChecklistItem,
} from './modules/checklists/application';
import type { DemoContentLedger } from './modules/demo/application';
import {
  type KeyBetween,
  makeCreateTask,
  makeUpdateTask,
  type TaskRepository,
} from './modules/tasks/application';
import { isAppError } from './shared/errors';

export const DEMO_CREDENTIALS: Credentials = { email: 'demo@example.com', password: 'demo1234' };

export type SeedDeps = {
  users: UserRepository;
  tasks: TaskRepository;
  checklists: ChecklistRepository;
  demo: DemoContentLedger;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  clock: () => Date;
  ids: () => string;
  keyBetween: KeyBetween;
};

export type SeedOutcome = { created: boolean; added: number };

const isoDateInDays = (today: Date, days: number): string =>
  new Date(today.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const seedDemo = async (
  deps: SeedDeps,
  today: Date,
  content: DemoTask[] = DEMO_TASKS,
): Promise<SeedOutcome> => {
  const session = await makeSignUp(deps)(DEMO_CREDENTIALS).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'CONFLICT') return undefined;
    throw error;
  });
  const userId = session?.user.id ?? (await deps.users.findByEmail(DEMO_CREDENTIALS.email))?.id;
  if (userId === undefined) throw new Error('the demo account could not be found or created');
  const now = today.toISOString();

  const given = await deps.demo.keys(userId);

  const createTask = makeCreateTask(deps);
  const updateTask = makeUpdateTask(deps);
  const addItem = makeAddChecklistItem(deps);
  const updateItem = makeUpdateChecklistItem(deps);
  let added = 0;

  for (const demo of content.toReversed()) {
    if (given.has(demo.key) || !(await deps.demo.claim(userId, demo.key, now))) continue;
    const { title, notes, priority, dueInDays } = demo;
    const dueDate = dueInDays === null ? null : isoDateInDays(today, dueInDays);
    const task = await createTask(userId, { title, notes, priority, dueDate });
    for (const { text, notes: itemNotes = '', done = false } of demo.checklist) {
      const item = await addItem(userId, task.id, { text, notes: itemNotes });
      if (done) await updateItem(userId, task.id, item.id, { done: true });
    }
    if (demo.done === true) await updateTask(userId, task.id, { status: 'done' });
    added += 1;
  }
  return { created: session !== undefined, added };
};

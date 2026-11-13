import { CreateTaskInput, SearchResult } from '@todo/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSignUp } from './modules/auth/application';
import { makeScryptHasher, SCRYPT_PARAMS } from './modules/auth/infrastructure/scryptHasher';
import { makeItemsOfUser, makeListChecklist } from './modules/checklists/application';
import { makeSearchTasks } from './modules/search/application';
import {
  makeCreateTask,
  makeListTasks,
  makeTasksOfUser,
  makeTrashTask,
  makeUpdateTask,
} from './modules/tasks/application';
import { keyBetween } from './modules/tasks/domain/ordering';
import { DEMO_TASKS, FIRST_SEED_KEYS } from './demoContent';
import { DEMO_CREDENTIALS, type SeedDeps, seedDemo } from './seed';
import type { Storage } from './storage';

const NOW = new Date('2026-11-11T09:30:00.000Z');

export const describeSeed = (name: string, open: () => Promise<Storage>): void => {
  describe(`seedDemo on ${name}`, () => {
    const opened: Storage[] = [];
    afterEach(async () => {
      for (const storage of opened.splice(0)) await storage.close();
    });

    const setup = async () => {
      const storage = await open();
      opened.push(storage);
      const deps: SeedDeps = {
        users: storage.users,
        tasks: storage.tasks,
        checklists: storage.checklists,
        demo: storage.demo,
        hasher: makeScryptHasher({ ...SCRYPT_PARAMS, N: 1024 }),
        tokens: { issue: async () => 't', verify: async () => undefined },
        clock: () => NOW,
        ids: () => crypto.randomUUID(),
        keyBetween,
      };
      const signUp = makeSignUp(deps);
      const userId = async (email: string): Promise<string> => {
        const account = await storage.users.findByEmail(email);
        if (account === undefined) throw new Error(`no account ${email}`);
        return account.id;
      };
      const titles = async (id: string) =>
        (await makeListTasks(deps)(id, { q: '' })).items.map(({ title }) => title);
      return {
        deps,
        storage,
        signUp,
        userId,
        titles,
        seed: (content = DEMO_TASKS) => seedDemo(deps, NOW, content),
      };
    };

    it('creates the demo account with all the demo content, in order', async () => {
      const { seed, userId, titles, deps } = await setup();

      expect(await seed()).toEqual({ created: true, added: DEMO_TASKS.length });

      const demo = await userId(DEMO_CREDENTIALS.email);
      const list = await titles(demo);
      expect(list).toHaveLength(DEMO_TASKS.length);
      expect(list[0]).toBe(DEMO_TASKS[0]?.title);
      const tasks = (await makeListTasks(deps)(demo, { q: '' })).items;
      expect(tasks.filter(({ status }) => status === 'done').length).toBeGreaterThanOrEqual(3);
      const withChecklist = tasks.filter(({ checklist }) => checklist.total > 0);
      expect(withChecklist.length).toBeGreaterThanOrEqual(4);
      expect(withChecklist.some(({ checklist }) => checklist.done > 0)).toBe(true);
      const firstWithItems = withChecklist[0];
      if (firstWithItems === undefined) throw new Error('expected a checklist');
      expect((await makeListChecklist(deps)(demo, firstWithItems.id)).items.length).toBe(
        firstWithItems.checklist.total,
      );
    });

    it('is idempotent: a second boot adds nothing', async () => {
      const { seed, userId, titles } = await setup();
      await seed();

      expect(await seed()).toEqual({ created: false, added: 0 });
      expect(await titles(await userId(DEMO_CREDENTIALS.email))).toHaveLength(DEMO_TASKS.length);
    });

    it('tops up an account from the first seed with only the tasks it lacks', async () => {
      const { deps, signUp, seed, userId, titles } = await setup();

      await signUp(DEMO_CREDENTIALS);
      const demo = await userId(DEMO_CREDENTIALS.email);
      const firstSeed = DEMO_TASKS.filter(({ key }) => FIRST_SEED_KEYS.includes(key));
      for (const { title, notes, priority } of firstSeed.toReversed()) {
        await makeCreateTask(deps)(demo, CreateTaskInput.parse({ title, notes, priority }));
      }
      for (const key of FIRST_SEED_KEYS) await deps.demo.claim(demo, key, NOW.toISOString());

      expect(await seed()).toEqual({ created: false, added: DEMO_TASKS.length - firstSeed.length });

      const list = await titles(demo);
      expect(list).toHaveLength(DEMO_TASKS.length);
      expect(new Set(list).size).toBe(list.length);
    });

    it('creates every demo task exactly once when two first boots race', async () => {
      const { deps, seed, userId, titles, storage } = await setup();

      let release = () => {};
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = () => {};
      const pausedAtLedger = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pausedLedger = {
        ...deps.demo,
        keys: async (id: string) => {
          entered();
          await barrier;
          return deps.demo.keys(id);
        },
      };
      const bootA = seedDemo({ ...deps, demo: pausedLedger }, NOW);
      await pausedAtLedger;
      const bootB = await seed();
      release();
      const outcomeA = await bootA;

      const demo = await userId(DEMO_CREDENTIALS.email);
      const list = await titles(demo);
      expect(list).toHaveLength(DEMO_TASKS.length);
      expect(new Set(list).size).toBe(list.length);
      expect(outcomeA.added + bootB.added).toBe(DEMO_TASKS.length);
      expect((await storage.demo.keys(demo)).size).toBe(DEMO_TASKS.length);
      expect(await seed()).toEqual({ created: false, added: 0 });
    });

    it('creates every demo task exactly once when two first boots run side by side', async () => {
      const { seed, userId, titles } = await setup();

      const [one, two] = await Promise.all([seed(), seed()]);

      const list = await titles(await userId(DEMO_CREDENTIALS.email));
      expect(list).toHaveLength(DEMO_TASKS.length);
      expect(new Set(list).size).toBe(list.length);
      expect(one.added + two.added).toBe(DEMO_TASKS.length);
    });

    it('adds tasks of a later content version, and never restores what the user changed', async () => {
      const { deps, seed, userId, titles } = await setup();
      const later = DEMO_TASKS.slice(-3);
      await seed(DEMO_TASKS.slice(0, -3));
      const demo = await userId(DEMO_CREDENTIALS.email);
      const [first, second] = (await makeListTasks(deps)(demo, { q: '' })).items;
      if (first === undefined || second === undefined) throw new Error('expected tasks');
      await makeTrashTask(deps)(demo, first.id);
      await makeUpdateTask(deps)(demo, second.id, { title: 'My own title' });

      expect(await seed()).toEqual({ created: false, added: later.length });

      const list = await titles(demo);
      expect(list).not.toContain(first.title);
      expect(list).toContain('My own title');
      later.forEach(({ title }) => {
        expect(list).toContain(title);
      });
    });

    it('never touches another user', async () => {
      const { deps, signUp, seed, userId, titles, storage } = await setup();
      await signUp({ email: 'other@example.com', password: 'password1' });
      const other = await userId('other@example.com');
      await makeCreateTask(deps)(other, CreateTaskInput.parse({ title: 'Mine' }));

      await seed();
      await seed();

      expect(await titles(other)).toEqual(['Mine']);
      expect(await storage.demo.keys(other)).toEqual(new Set());
    });

    it('gives search what it needs: repeats, overlaps and a checklist-only match', async () => {
      const { deps, seed, userId } = await setup();
      await seed();
      const demo = await userId(DEMO_CREDENTIALS.email);
      const search = async (q: string) =>
        SearchResult.parse(
          await makeSearchTasks({
            tasksOf: makeTasksOfUser(deps),
            itemsOf: makeItemsOfUser(deps),
          })(demo, { q }),
        );

      const budget = await search('budget');
      expect(budget.hits.length).toBeGreaterThanOrEqual(3);
      expect(
        Math.max(...budget.hits.map(({ matchCount }) => matchCount.value)),
      ).toBeGreaterThanOrEqual(5);
      const onlyInItem = await search('sunscreen');
      expect(onlyInItem.hits[0]?.matches.map(({ field }) => field)).toEqual(['item']);
      expect((await search('resume')).hits.length).toBeGreaterThan(0);
      expect((await search('cafe')).hits.length).toBeGreaterThan(0);
      expect((await search('draw')).hits.length).toBeGreaterThan(0);
    });
  });
};

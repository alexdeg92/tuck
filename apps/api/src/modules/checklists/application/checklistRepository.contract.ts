import type { ChecklistItem } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import {
  keyBetween,
  type KeyBetween,
  type NewTask,
  type TaskRepository,
} from '../../tasks/application';
import type { ChecklistRepository, NewChecklistItem } from './ports';

/** Both adapters of one engine over the same store: items need a task, and its owner. */
export type ChecklistHarness = {
  tasks: TaskRepository;
  checklists: ChecklistRepository;
  createUser: () => Promise<string>;
};

/**
 * The behaviour every ChecklistRepository must have, with the task summary it feeds.
 * Run by the memory, SQLite and Postgres adapters.
 */
const NOW = '2026-11-11T09:30:00.000Z';
const LATER = '2026-11-12T10:00:00.000Z';
const LIMIT = 50;

export const describeChecklistRepository = (
  name: string,
  setup: () => Promise<ChecklistHarness>,
): void => {
  describe(`${name} checklist repository (contract)`, () => {
    const newTask = (title = 'Groceries'): NewTask => ({
      id: crypto.randomUUID(),
      title,
      notes: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const newItem = (text: string, notes = ''): NewChecklistItem => ({
      id: crypto.randomUUID(),
      text,
      notes,
      done: false,
      createdAt: NOW,
      updatedAt: NOW,
    });

    /** A user with one task holding the given items, added one after another. */
    const withChecklist = async (texts: string[]) => {
      const { tasks, checklists, createUser } = await setup();
      const userId = await createUser();
      const task = await tasks.insertAtTop(userId, newTask(), keyBetween);
      const items = await texts.reduce<Promise<ChecklistItem[]>>(async (previous, text) => {
        const done = await previous;
        const item = await checklists.insertItemAtBottom(
          userId,
          task.id,
          newItem(text),
          keyBetween,
          LIMIT,
        );
        if (item === undefined) throw new Error('task vanished');
        return [...done, item];
      }, Promise.resolve([]));
      const byText = (text: string): ChecklistItem => {
        const item = items.find((candidate) => candidate.text === text);
        if (item === undefined) throw new Error(`no item "${text}"`);
        return item;
      };
      const textsInOrder = async () =>
        ((await checklists.listItems(userId, task.id)) ?? []).map(({ text }) => text);
      return { tasks, checklists, createUser, userId, task, byText, textsInOrder };
    };

    describe('insertItemAtBottom and listItems', () => {
      it('returns an empty checklist for a new task', async () => {
        const { checklists, userId, task } = await withChecklist([]);
        expect(await checklists.listItems(userId, task.id)).toEqual([]);
      });

      it('stores every field and appends each new item at the bottom', async () => {
        const { checklists, userId, task } = await withChecklist([]);
        const first = await checklists.insertItemAtBottom(
          userId,
          task.id,
          newItem('Oat milk', 'barista'),
          keyBetween,
          LIMIT,
        );
        const second = await checklists.insertItemAtBottom(
          userId,
          task.id,
          newItem('Eggs'),
          keyBetween,
          LIMIT,
        );

        expect(first).toMatchObject({
          taskId: task.id,
          text: 'Oat milk',
          notes: 'barista',
          done: false,
        });
        expect(await checklists.listItems(userId, task.id)).toEqual([first, second]);
      });

      it("treats another user's task like a missing one", async () => {
        const { checklists, createUser, task } = await withChecklist(['Eggs']);
        const stranger = await createUser();

        expect(await checklists.listItems(stranger, task.id)).toBeUndefined();
        expect(
          await checklists.insertItemAtBottom(
            stranger,
            task.id,
            newItem('Sneaky'),
            keyBetween,
            LIMIT,
          ),
        ).toBeUndefined();
        expect(await checklists.listItems(stranger, crypto.randomUUID())).toBeUndefined();
      });

      it('refuses the item past the limit with CONFLICT and keeps the checklist as it was', async () => {
        const { checklists, userId, task, textsInOrder } = await withChecklist(['1', '2', '3']);

        await expect(
          checklists.insertItemAtBottom(userId, task.id, newItem('4'), keyBetween, 3),
        ).rejects.toMatchObject({ code: 'CONFLICT', message: 'A checklist holds at most 3 items' });
        expect(await textsInOrder()).toEqual(['1', '2', '3']);
      });

      it('lands concurrent additions one after another, without a conflict', async () => {
        const { checklists, userId, task } = await withChecklist([]);

        const added = await Promise.all(
          ['1', '2', '3', '4', '5'].map((text) =>
            checklists.insertItemAtBottom(userId, task.id, newItem(text), keyBetween, LIMIT),
          ),
        );

        expect(new Set(added.map((item) => item?.position)).size).toBe(5);
        expect(await checklists.listItems(userId, task.id)).toHaveLength(5);
      });

      it('rejects a position collision with CONFLICT and writes nothing', async () => {
        const { checklists, userId, task, byText, textsInOrder } = await withChecklist(['Eggs']);
        const collide: KeyBetween = () => byText('Eggs').position;

        await expect(
          checklists.insertItemAtBottom(userId, task.id, newItem('Milk'), collide, LIMIT),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await textsInOrder()).toEqual(['Eggs']);
      });
    });

    describe('updateItem and removeItem', () => {
      it('changes only the given fields and stamps updatedAt', async () => {
        const { checklists, userId, task, byText } = await withChecklist(['Eggs']);
        const eggs = byText('Eggs');

        const updated = await checklists.updateItem(
          userId,
          task.id,
          eggs.id,
          { done: true, notes: 'six' },
          LATER,
        );

        expect(updated).toEqual({ ...eggs, done: true, notes: 'six', updatedAt: LATER });
        expect(await checklists.listItems(userId, task.id)).toEqual([updated]);
      });

      it('finds an item only through its own task and its owner', async () => {
        const { tasks, checklists, createUser, userId, task, byText } = await withChecklist([
          'Eggs',
        ]);
        const other = await tasks.insertAtTop(userId, newTask('Other'), keyBetween);
        const eggs = byText('Eggs');
        const stranger = await createUser();

        expect(
          await checklists.updateItem(userId, other.id, eggs.id, { done: true }, LATER),
        ).toBeUndefined();
        expect(
          await checklists.updateItem(stranger, task.id, eggs.id, { done: true }, LATER),
        ).toBeUndefined();
        expect(await checklists.removeItem(stranger, task.id, eggs.id)).toBe(false);
        expect(await checklists.removeItem(userId, other.id, eggs.id)).toBe(false);
        expect(await checklists.listItems(userId, task.id)).toEqual([eggs]);
      });

      it('deletes an item once', async () => {
        const { checklists, userId, task, byText, textsInOrder } = await withChecklist([
          'Eggs',
          'Milk',
        ]);

        expect(await checklists.removeItem(userId, task.id, byText('Eggs').id)).toBe(true);
        expect(await checklists.removeItem(userId, task.id, byText('Eggs').id)).toBe(false);
        expect(await textsInOrder()).toEqual(['Milk']);
      });

      it('adds an item or reports a missing task when its task is trashed at the same time', async () => {
        for (let round = 0; round < 5; round += 1) {
          const { tasks, checklists, userId, task } = await withChecklist(['Eggs']);
          await Promise.all([tasks.list(userId), tasks.list(userId)]); // two warm connections

          const [trashed, added] = await Promise.allSettled([
            tasks.trash(userId, task.id, LATER),
            checklists.insertItemAtBottom(userId, task.id, newItem('Milk'), keyBetween, LIMIT),
          ]);

          expect(trashed).toMatchObject({ status: 'fulfilled', value: { id: task.id } });
          expect(added.status).toBe('fulfilled'); // never a raw foreign-key error
          expect(await checklists.listItems(userId, task.id)).toBeUndefined();
        }
      });

      it("deletes a task's items with the task", async () => {
        const { tasks, checklists, userId, task } = await withChecklist(['Eggs', 'Milk']);
        await tasks.trash(userId, task.id, LATER);

        await tasks.deleteForever(userId, task.id);

        expect(await tasks.restore(userId, task.id)).toBeUndefined();
        expect(await checklists.listItems(userId, task.id)).toBeUndefined();
      });
    });

    describe('moveItemAfter', () => {
      it.each([
        ['to the top', 'C', null, ['C', 'A', 'B']],
        ['after an anchor', 'A', 'B', ['B', 'A', 'C']],
        ['after the last item', 'A', 'C', ['B', 'C', 'A']],
      ])('moves an item %s', async (_label, moved, anchor, expected) => {
        const { checklists, userId, task, byText, textsInOrder } = await withChecklist([
          'A',
          'B',
          'C',
        ]);

        const result = await checklists.moveItemAfter(
          userId,
          task.id,
          byText(moved).id,
          anchor === null ? null : byText(anchor).id,
          keyBetween,
          LATER,
        );

        expect(result).toMatchObject({ id: byText(moved).id, updatedAt: LATER });
        expect(await textsInOrder()).toEqual(expected);
      });

      it('returns undefined for an anchor from another task, and moves nothing', async () => {
        const { tasks, checklists, userId, task, byText, textsInOrder } = await withChecklist([
          'A',
          'B',
        ]);
        const other = await tasks.insertAtTop(userId, newTask('Other'), keyBetween);
        const foreign = await checklists.insertItemAtBottom(
          userId,
          other.id,
          newItem('X'),
          keyBetween,
          LIMIT,
        );

        expect(
          await checklists.moveItemAfter(
            userId,
            task.id,
            byText('A').id,
            foreign?.id ?? null,
            keyBetween,
            LATER,
          ),
        ).toBeUndefined();
        expect(await textsInOrder()).toEqual(['A', 'B']);
      });

      it('rejects a position collision with CONFLICT and keeps the old position', async () => {
        const { checklists, userId, task, byText, textsInOrder } = await withChecklist([
          'A',
          'B',
          'C',
        ]);
        const collide: KeyBetween = () => byText('B').position;

        await expect(
          checklists.moveItemAfter(userId, task.id, byText('A').id, byText('C').id, collide, LATER),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await textsInOrder()).toEqual(['A', 'B', 'C']);
      });
    });

    describe('listForUser', () => {
      it("returns only the user's items, by task then position", async () => {
        const { tasks, checklists, createUser, userId, task } = await withChecklist(['A', 'B']);
        const stranger = await createUser();
        const theirs = await tasks.insertAtTop(stranger, newTask('Theirs'), keyBetween);
        await checklists.insertItemAtBottom(stranger, theirs.id, newItem('X'), keyBetween, LIMIT);

        const items = await checklists.listForUser(userId);

        expect(items.map(({ text, taskId }) => [text, taskId])).toEqual([
          ['A', task.id],
          ['B', task.id],
        ]);
      });

      it('is empty for a new user', async () => {
        const { checklists, createUser } = await setup();
        expect(await checklists.listForUser(await createUser())).toEqual([]);
      });
    });

    describe('the task checklist summary', () => {
      it('counts done and total items on every task read', async () => {
        const { tasks, checklists, userId, task, byText } = await withChecklist(['A', 'B', 'C']);
        await checklists.updateItem(userId, task.id, byText('A').id, { done: true }, LATER);
        await checklists.removeItem(userId, task.id, byText('C').id);

        expect((await tasks.findById(userId, task.id))?.checklist).toEqual({ done: 1, total: 2 });
        expect((await tasks.list(userId))[0]?.checklist).toEqual({ done: 1, total: 2 });
      });

      it('starts empty', async () => {
        const { task } = await withChecklist([]);
        expect(task.checklist).toEqual({ done: 0, total: 0 });
      });
    });

    describe('a task in the trash', () => {
      it('keeps its checklist out of reach until it is restored', async () => {
        const { tasks, checklists, userId, task, byText } = await withChecklist(['Eggs', 'Milk']);
        const eggs = byText('Eggs');
        await tasks.trash(userId, task.id, LATER);

        expect(await checklists.listItems(userId, task.id)).toBeUndefined();
        expect(await checklists.listForUser(userId)).toEqual([]);
        expect(
          await checklists.insertItemAtBottom(userId, task.id, newItem('Bread'), keyBetween, LIMIT),
        ).toBeUndefined();
        expect(
          await checklists.updateItem(userId, task.id, eggs.id, { done: true }, LATER),
        ).toBeUndefined();
        expect(
          await checklists.moveItemAfter(userId, task.id, eggs.id, null, keyBetween, LATER),
        ).toBeUndefined();
        expect(await checklists.removeItem(userId, task.id, eggs.id)).toBe(false);

        await tasks.restore(userId, task.id);
        expect((await checklists.listItems(userId, task.id))?.map(({ text }) => text)).toEqual([
          'Eggs',
          'Milk',
        ]);
      });

      it('shows its checklist summary in the trash', async () => {
        const { tasks, checklists, userId, task, byText } = await withChecklist(['Eggs', 'Milk']);
        await checklists.updateItem(userId, task.id, byText('Eggs').id, { done: true }, LATER);
        await tasks.trash(userId, task.id, LATER);

        expect((await tasks.listTrash(userId))[0]?.checklist).toEqual({ done: 1, total: 2 });
      });

      it('loses its items when it is purged or emptied', async () => {
        const { tasks, checklists, userId, task } = await withChecklist(['Eggs']);
        const other = await tasks.insertAtTop(userId, newTask('Other'), keyBetween);
        await checklists.insertItemAtBottom(userId, other.id, newItem('Step'), keyBetween, LIMIT);
        await tasks.trash(userId, task.id, NOW);
        await tasks.trash(userId, other.id, NOW);

        await tasks.purgeDeletedBefore(NOW);
        await tasks.restore(userId, task.id);

        expect(await checklists.listForUser(userId)).toEqual([]);
      });
    });
  });
};

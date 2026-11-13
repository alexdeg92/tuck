import { Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { keyBetween } from '../domain/ordering';
import type { NewTask } from './ports';
import type { RepositoryHarness } from './taskRepository.contract';

/**
 * The trash behaviour every TaskRepository must have. A trashed task keeps its row, its checklist
 * and its position, but every normal read and write treats it as missing until it's restored.
 * Run by the memory, SQLite and Postgres adapters next to the task suite; what it means for a
 * checklist is in the checklist suite.
 */
const NOW = '2026-11-11T09:30:00.000Z';
const DELETED = '2026-11-12T10:00:00.000Z';
const DELETED_LATER = '2026-11-13T08:00:00.000Z';

export const describeTrashRepository = (
  name: string,
  setup: () => Promise<RepositoryHarness>,
): void => {
  describe(`${name} trash repository (contract)`, () => {
    const draft = (title: string): NewTask => ({
      id: crypto.randomUUID(),
      title,
      notes: `${title} notes`,
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const seed = async (titles: string[]) => {
      const harness = await setup();
      const { tasks } = harness;
      const userId = await harness.createUser();
      const created: Task[] = [];
      for (const title of [...titles].reverse()) {
        created.unshift(await tasks.insertAtTop(userId, draft(title), keyBetween));
      }
      const idOf = (title: string): string => {
        const task = created.find((candidate) => candidate.title === title);
        if (task === undefined) throw new Error(`no seeded task "${title}"`);
        return task.id;
      };
      const titlesInOrder = async () => (await tasks.list(userId)).map(({ title }) => title);
      const trashTitles = async () => (await tasks.listTrash(userId)).map(({ title }) => title);
      return { ...harness, userId, idOf, titlesInOrder, trashTitles };
    };

    describe('trash', () => {
      it('moves the task to the trash and returns it with deletedAt', async () => {
        const { tasks, userId, idOf, titlesInOrder } = await seed(['A', 'B']);

        const trashed = await tasks.trash(userId, idOf('A'), DELETED);

        expect(trashed).toMatchObject({ id: idOf('A'), title: 'A', deletedAt: DELETED });
        expect(await titlesInOrder()).toEqual(['B']);
      });

      it('is idempotent: a second call keeps the first deletedAt', async () => {
        const { tasks, userId, idOf } = await seed(['A']);
        await tasks.trash(userId, idOf('A'), DELETED);

        expect(await tasks.trash(userId, idOf('A'), DELETED_LATER)).toMatchObject({
          deletedAt: DELETED,
        });
      });

      it("refuses another user's task and a missing one", async () => {
        const { tasks, createUser, idOf, titlesInOrder } = await seed(['A']);

        expect(await tasks.trash(await createUser(), idOf('A'), DELETED)).toBeUndefined();
        expect(await tasks.trash(await createUser(), crypto.randomUUID(), DELETED)).toBeUndefined();
        expect(await titlesInOrder()).toEqual(['A']);
      });
    });

    describe('a trashed task is hidden from every normal read and write', () => {
      const trashedB = async () => {
        const seeded = await seed(['A', 'B', 'C']);
        await seeded.tasks.trash(seeded.userId, seeded.idOf('B'), DELETED);
        return { ...seeded, id: seeded.idOf('B') };
      };

      it('is not found or listed', async () => {
        const { tasks, userId, id, titlesInOrder } = await trashedB();

        expect(await tasks.findById(userId, id)).toBeUndefined();
        expect(await titlesInOrder()).toEqual(['A', 'C']);
      });

      it('cannot be updated, moved or used as a move anchor', async () => {
        const { tasks, userId, id, idOf, titlesInOrder } = await trashedB();

        expect(await tasks.update(userId, id, { title: 'Changed' }, DELETED_LATER)).toBeUndefined();
        expect(await tasks.moveAfter(userId, id, null, keyBetween, DELETED_LATER)).toBeUndefined();
        expect(
          await tasks.moveAfter(userId, idOf('A'), id, keyBetween, DELETED_LATER),
        ).toBeUndefined();
        expect(await titlesInOrder()).toEqual(['A', 'C']);
      });
    });

    describe('listTrash', () => {
      it("lists only the user's trashed tasks, most recently deleted first", async () => {
        const { tasks, userId, idOf, createUser } = await seed(['A', 'B', 'C']);
        await tasks.trash(userId, idOf('A'), DELETED);
        await tasks.trash(userId, idOf('C'), DELETED_LATER);
        const stranger = await createUser();
        await tasks.trash(
          stranger,
          (await tasks.insertAtTop(stranger, draft('Theirs'), keyBetween)).id,
          DELETED,
        );

        const trash = await tasks.listTrash(userId);

        expect(trash.map(({ title, deletedAt }) => [title, deletedAt])).toEqual([
          ['C', DELETED_LATER],
          ['A', DELETED],
        ]);
      });
    });

    describe('restore', () => {
      it('puts the task back where it was, with its fields', async () => {
        const { tasks, userId, idOf, titlesInOrder, trashTitles } = await seed(['A', 'B', 'C']);

        const before = Task.parse(await tasks.findById(userId, idOf('B')));
        await tasks.trash(userId, idOf('B'), DELETED);

        expect(await tasks.restore(userId, idOf('B'))).toEqual(before);
        expect(await titlesInOrder()).toEqual(['A', 'B', 'C']);
        expect(await trashTitles()).toEqual([]);
      });

      it('keeps its place after inserts and moves made while it was in the trash, without a collision', async () => {
        const { tasks, userId, idOf, titlesInOrder } = await seed(['A', 'B', 'C']);
        await tasks.trash(userId, idOf('B'), DELETED);

        const n1 = await tasks.insertAtTop(userId, draft('N1'), keyBetween);
        await tasks.insertAtTop(userId, draft('N2'), keyBetween);
        await tasks.moveAfter(userId, idOf('C'), null, keyBetween, DELETED_LATER);

        await tasks.moveAfter(userId, n1.id, idOf('A'), keyBetween, DELETED_LATER);

        await tasks.restore(userId, idOf('B'));

        expect(await titlesInOrder()).toEqual(['C', 'N2', 'A', 'N1', 'B']);
      });

      it('brings a completed task back among the completed ones', async () => {
        const { tasks, userId, idOf, titlesInOrder } = await seed(['A', 'B']);
        await tasks.update(userId, idOf('A'), { status: 'done' }, DELETED);
        await tasks.trash(userId, idOf('A'), DELETED_LATER);

        expect(await tasks.restore(userId, idOf('A'))).toMatchObject({
          status: 'done',
          completedAt: DELETED,
        });
        expect(await titlesInOrder()).toEqual(['B', 'A']);
      });

      it('returns a task that is not in the trash unchanged (a repeated restore succeeds)', async () => {
        const { tasks, userId, idOf } = await seed(['A']);
        const live = Task.parse(await tasks.findById(userId, idOf('A')));

        expect(await tasks.restore(userId, idOf('A'))).toEqual(live);
      });

      it("refuses another user's task and a missing one", async () => {
        const { tasks, userId, createUser, idOf, trashTitles } = await seed(['A']);
        await tasks.trash(userId, idOf('A'), DELETED);

        expect(await tasks.restore(await createUser(), idOf('A'))).toBeUndefined();
        expect(await tasks.restore(userId, crypto.randomUUID())).toBeUndefined();
        expect(await trashTitles()).toEqual(['A']);
      });
    });

    describe('deleteForever', () => {
      it('deletes a trashed task for good', async () => {
        const { tasks, userId, idOf, trashTitles } = await seed(['A']);
        await tasks.trash(userId, idOf('A'), DELETED);

        expect(await tasks.deleteForever(userId, idOf('A'))).toBe(true);
        expect(await trashTitles()).toEqual([]);
        expect(await tasks.restore(userId, idOf('A'))).toBeUndefined();
        expect(await tasks.deleteForever(userId, idOf('A'))).toBe(false);
      });

      it("never deletes a task that isn't in the trash, nor another user's", async () => {
        const { tasks, userId, createUser, idOf, titlesInOrder, trashTitles } = await seed([
          'A',
          'B',
        ]);
        await tasks.trash(userId, idOf('B'), DELETED);

        expect(await tasks.deleteForever(userId, idOf('A'))).toBe(false);
        expect(await tasks.deleteForever(await createUser(), idOf('B'))).toBe(false);
        expect(await titlesInOrder()).toEqual(['A']);
        expect(await trashTitles()).toEqual(['B']);
      });
    });

    describe('emptyTrash', () => {
      it('deletes every trashed task of this user only, and counts them', async () => {
        const { tasks, userId, createUser, idOf, titlesInOrder, trashTitles } = await seed([
          'A',
          'B',
          'C',
        ]);
        await tasks.trash(userId, idOf('A'), DELETED);
        await tasks.trash(userId, idOf('B'), DELETED);
        const stranger = await createUser();
        const theirs = await tasks.insertAtTop(stranger, draft('Theirs'), keyBetween);
        await tasks.trash(stranger, theirs.id, DELETED);

        expect(await tasks.emptyTrash(userId)).toBe(2);
        expect(await trashTitles()).toEqual([]);
        expect(await titlesInOrder()).toEqual(['C']);
        expect((await tasks.listTrash(stranger)).map(({ title }) => title)).toEqual(['Theirs']);
        expect(await tasks.emptyTrash(userId)).toBe(0);
      });
    });

    describe('purgeDeletedBefore', () => {
      it('deletes, for every user, the tasks trashed at or before the cutoff', async () => {
        const { tasks, userId, createUser, idOf, titlesInOrder, trashTitles } = await seed([
          'Old',
          'Recent',
          'Live',
        ]);
        await tasks.trash(userId, idOf('Old'), DELETED);
        await tasks.trash(userId, idOf('Recent'), DELETED_LATER);
        const stranger = await createUser();
        const theirs = await tasks.insertAtTop(stranger, draft('Theirs'), keyBetween);
        await tasks.trash(stranger, theirs.id, DELETED);

        expect(await tasks.purgeDeletedBefore(DELETED)).toBe(2);
        expect(await trashTitles()).toEqual(['Recent']);
        expect(await titlesInOrder()).toEqual(['Live']);
        expect(await tasks.listTrash(stranger)).toEqual([]);
        expect(await tasks.restore(userId, idOf('Old'))).toBeUndefined();
      });

      it('is idempotent and safe to run from several instances at once', async () => {
        const { tasks, userId, idOf, trashTitles } = await seed(['A', 'B']);
        await tasks.trash(userId, idOf('A'), DELETED);
        await tasks.trash(userId, idOf('B'), DELETED);

        const counts = await Promise.all([
          tasks.purgeDeletedBefore(DELETED_LATER),
          tasks.purgeDeletedBefore(DELETED_LATER),
        ]);

        expect(counts[0] + counts[1]).toBe(2);
        expect(await tasks.purgeDeletedBefore(DELETED_LATER)).toBe(0);
        expect(await trashTitles()).toEqual([]);
      });
    });
  });
};

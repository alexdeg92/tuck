import { Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { keyBetween, type KeyBetween } from '../domain/ordering';
import type { NewTask, TaskRepository } from './ports';

/**
 * The behaviour every TaskRepository must have. The memory, SQLite and Postgres adapters all
 * run it, which is what makes them interchangeable.
 */
export type RepositoryHarness = { tasks: TaskRepository; createUser: () => Promise<string> };

const NOW = '2026-11-11T09:30:00.000Z';
const LATER = '2026-11-12T10:00:00.000Z';
const LATEST = '2026-11-13T11:00:00.000Z';

/** The task part of what a repository returns (findById and update also carry notesDoc). */
const plain = (task: Task | undefined): Task | undefined =>
  task === undefined ? undefined : Task.parse(task);

export const describeTaskRepository = (
  name: string,
  setup: () => Promise<RepositoryHarness>,
): void => {
  describe(`${name} task repository (contract)`, () => {
    const draft = (overrides: Partial<NewTask> = {}): NewTask => ({
      id: crypto.randomUUID(),
      title: 'Task',
      notes: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    });

    const seed = async (titles: string[]) => {
      const { tasks, createUser } = await setup();
      const userId = await createUser();
      // Inserted at the top one at a time (each waits for the previous: concurrent inserts would
      // race for the same top key), in reverse so they list in the given order.
      const created = await [...titles]
        .reverse()
        .reduce<Promise<Task[]>>(async (previous, title) => {
          const done = await previous;
          return [await tasks.insertAtTop(userId, draft({ title }), keyBetween), ...done];
        }, Promise.resolve([]));
      const byTitle = (title: string): Task => {
        const task = created.find((candidate) => candidate.title === title);
        if (!task) throw new Error(`no seeded task "${title}"`);
        return task;
      };
      const titlesInOrder = async () => (await tasks.list(userId)).map(({ title }) => title);
      return { tasks, createUser, userId, byTitle, titlesInOrder };
    };

    describe('insertAtTop and list', () => {
      it('returns an empty list for a new user', async () => {
        const { tasks, createUser } = await setup();
        expect(await tasks.list(await createUser())).toEqual([]);
      });

      it('stores every field and places each new task first', async () => {
        const { tasks, createUser } = await setup();
        const userId = await createUser();
        const first = await tasks.insertAtTop(
          userId,
          draft({ title: 'First', notes: 'n', priority: 'high', dueDate: '2026-12-01' }),
          keyBetween,
        );
        const second = await tasks.insertAtTop(userId, draft({ title: 'Second' }), keyBetween);

        expect(first).toMatchObject({
          title: 'First',
          notes: 'n',
          priority: 'high',
          dueDate: '2026-12-01',
        });
        expect(second.position < first.position).toBe(true);
        expect(await tasks.list(userId)).toEqual([second, first]);
      });

      it("never lists another user's tasks", async () => {
        const { tasks, createUser } = await seed(['Mine']);
        expect(await tasks.list(await createUser())).toEqual([]);
      });

      it('lands concurrent inserts one after another, all at the top, without a conflict', async () => {
        const { tasks, createUser } = await setup();
        const userId = await createUser();

        const inserted = await Promise.all(
          ['1', '2', '3', '4', '5'].map((title) =>
            tasks.insertAtTop(userId, draft({ title }), keyBetween),
          ),
        );

        expect(new Set(inserted.map(({ position }) => position)).size).toBe(5);
        expect(await tasks.list(userId)).toHaveLength(5);
      });

      it('rejects a position collision with CONFLICT and writes nothing', async () => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['Existing']);
        const collide: KeyBetween = () => byTitle('Existing').position;

        await expect(
          tasks.insertAtTop(userId, draft({ title: 'New' }), collide),
        ).rejects.toMatchObject({
          code: 'CONFLICT',
        });
        expect(await titlesInOrder()).toEqual(['Existing']);
      });
    });

    describe('completed tasks', () => {
      const T1 = '2026-11-12T08:00:00.000Z';
      const T2 = '2026-11-12T09:00:00.000Z';

      it('lists open tasks by position, then done tasks most recently completed first', async () => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B', 'C', 'D']);
        await tasks.update(userId, byTitle('B').id, { status: 'done' }, T1);
        await tasks.update(userId, byTitle('D').id, { status: 'done' }, T2);

        expect(await titlesInOrder()).toEqual(['A', 'C', 'D', 'B']);
        expect((await tasks.findById(userId, byTitle('D').id))?.completedAt).toBe(T2);
      });

      it('stamps completion itself: set on done, kept while done, cleared on reopen', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const id = byTitle('A').id;

        expect((await tasks.update(userId, id, { status: 'done' }, T1))?.completedAt).toBe(T1);
        expect((await tasks.update(userId, id, { status: 'done' }, T2))?.completedAt).toBe(T1);
        expect((await tasks.update(userId, id, { title: 'A2' }, T2))?.completedAt).toBe(T1);
        expect((await tasks.update(userId, id, { status: 'todo' }, T2))?.completedAt).toBeNull();
      });

      it('never restores an older completion stamp when toggles race', async () => {
        const T0 = '2026-11-12T00:00:00.000Z';
        const T3 = '2026-11-12T03:00:00.000Z';
        for (let round = 0; round < 5; round += 1) {
          const { tasks, userId, byTitle } = await seed(['A']);
          const id = byTitle('A').id;
          await tasks.update(userId, id, { status: 'done' }, T0);
          await Promise.all([tasks.list(userId), tasks.list(userId)]); // two warm connections

          await Promise.all([
            tasks.update(userId, id, { status: 'done' }, T1),
            tasks.update(userId, id, { status: 'todo' }, T2),
            tasks.update(userId, id, { status: 'done' }, T3),
          ]);

          // Every serial order ends with no stamp or one of this round's writes (T1, T3, or just
          // after T3 when T1 is applied last: the write version never goes back): never T0.
          const task = await tasks.findById(userId, id);
          const stamp = task?.completedAt ?? null;
          expect(stamp === null || stamp >= T1).toBe(true);
          expect(task?.status === 'done').toBe(task?.completedAt !== null);
        }
      });

      it('breaks a completedAt tie by id', async () => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B']);
        await tasks.update(userId, byTitle('A').id, { status: 'done' }, T1);
        await tasks.update(userId, byTitle('B').id, { status: 'done' }, T1);
        const [first, second] = [byTitle('A'), byTitle('B')].sort((a, b) => (a.id < b.id ? -1 : 1));

        expect(await titlesInOrder()).toEqual([first?.title, second?.title]);
      });

      it('puts a reopened task back where it was among the open tasks', async () => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B', 'C']);
        await tasks.update(userId, byTitle('B').id, { status: 'done' }, T1);
        expect(await titlesInOrder()).toEqual(['A', 'C', 'B']);

        await tasks.update(userId, byTitle('B').id, { status: 'todo' }, LATER);

        expect(await titlesInOrder()).toEqual(['A', 'B', 'C']);
        expect((await tasks.findById(userId, byTitle('B').id))?.completedAt).toBeNull();
      });

      it('moves an open task between open tasks while done tasks stay at the end', async () => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B', 'C', 'D']);
        await tasks.update(userId, byTitle('B').id, { status: 'done' }, T1);

        await tasks.moveAfter(userId, byTitle('D').id, byTitle('A').id, keyBetween, LATER);

        expect(await titlesInOrder()).toEqual(['A', 'D', 'C', 'B']);
      });
    });

    describe('findById', () => {
      it("finds the owner's task only", async () => {
        const { tasks, userId, createUser, byTitle } = await seed(['A']);
        const task = byTitle('A');

        expect(plain(await tasks.findById(userId, task.id))).toEqual(task);
        expect(await tasks.findById(await createUser(), task.id)).toBeUndefined();
        expect(await tasks.findById(userId, crypto.randomUUID())).toBeUndefined();
      });
    });

    describe('formatted notes', () => {
      const note = {
        type: 'doc' as const,
        content: [
          { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Plan' }] },
        ],
      };

      it('stores a doc with its notes, reads it back, and clears it with a null', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const saved = await tasks.update(userId, task.id, { notes: 'Plan', notesDoc: note }, LATER);
        expect(saved).toMatchObject({ notes: 'Plan', notesDoc: note });
        expect(await tasks.findById(userId, task.id)).toMatchObject({ notesDoc: note });

        await tasks.update(userId, task.id, { notes: 'text', notesDoc: null }, LATER);
        expect(await tasks.findById(userId, task.id)).toMatchObject({
          notes: 'text',
          notesDoc: null,
        });
      });

      it('reads a task never saved with a doc as having none', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        expect(await tasks.findById(userId, byTitle('A').id)).toMatchObject({ notesDoc: null });
      });
    });

    describe('update', () => {
      it('changes only the given fields and stamps updatedAt', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const updated = await tasks.update(
          userId,
          task.id,
          { status: 'done', dueDate: null },
          LATER,
        );

        expect(plain(updated)).toEqual({
          ...task,
          status: 'done',
          completedAt: LATER,
          dueDate: null,
          updatedAt: LATER,
        });
        expect(await tasks.findById(userId, task.id)).toEqual(updated);
      });

      it('stores notes of 20 000 characters, the largest a note may be', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const notes = 'é'.repeat(20_000);

        expect((await tasks.update(userId, byTitle('A').id, { notes }, LATER))?.notes).toBe(notes);
      });

      it("returns undefined for another user's task and leaves it unchanged", async () => {
        const { tasks, userId, createUser, byTitle } = await seed(['A']);
        const task = byTitle('A');

        expect(
          await tasks.update(await createUser(), task.id, { title: 'Hijacked' }, LATER),
        ).toBeUndefined();
        expect(plain(await tasks.findById(userId, task.id))).toEqual(task);
      });

      it('writes when expectedUpdatedAt still matches the stored updatedAt', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const updated = await tasks.update(userId, task.id, { notes: 'mine' }, LATER, NOW);

        expect(plain(updated)).toEqual({ ...task, notes: 'mine', updatedAt: LATER });
      });

      it('refuses a stale expectedUpdatedAt with CONFLICT carrying the stored task, and writes nothing', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');
        const theirs = await tasks.update(userId, task.id, { notes: 'theirs' }, LATER);

        const attempt = tasks.update(userId, task.id, { notes: 'mine' }, LATEST, NOW);

        await expect(attempt).rejects.toMatchObject({ code: 'CONFLICT', current: theirs });
        expect(await tasks.findById(userId, task.id)).toEqual(theirs);
      });

      it('lets exactly one of two writers with the same expectedUpdatedAt win', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const results = await Promise.allSettled([
          tasks.update(userId, task.id, { notes: 'first' }, LATER, NOW),
          tasks.update(userId, task.id, { notes: 'second' }, LATEST, NOW),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const [refused] = results.filter((result) => result.status === 'rejected');
        expect(refused?.reason).toMatchObject({ code: 'CONFLICT' });
      });

      it('advances updatedAt on every write, even when the clock repeats or goes back', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const first = await tasks.update(userId, task.id, { notes: 'one' }, NOW);
        const second = await tasks.update(userId, task.id, { notes: 'two' }, NOW);

        expect(first && first.updatedAt > task.updatedAt).toBe(true);
        expect(second && first && second.updatedAt > first.updatedAt).toBe(true);
      });

      it('with a repeating clock, a second write on the same precondition is refused (one winner)', async () => {
        const { tasks, userId, byTitle } = await seed(['A']);
        const task = byTitle('A');

        const first = await tasks.update(userId, task.id, { notes: 'first' }, NOW, task.updatedAt);
        const stale = tasks.update(
          userId,
          task.id,
          { notes: 'stale overwrite' },
          NOW,
          task.updatedAt,
        );

        await expect(stale).rejects.toMatchObject({ code: 'CONFLICT', current: first });
        expect(await tasks.findById(userId, task.id)).toEqual(first);
      });

      it("returns undefined, not CONFLICT, for another user's task with a precondition", async () => {
        const { tasks, createUser, byTitle } = await seed(['A']);

        expect(
          await tasks.update(await createUser(), byTitle('A').id, { notes: 'x' }, LATER, LATER),
        ).toBeUndefined();
      });
    });

    describe('moveAfter', () => {
      it.each([
        ['to the top', 'D', null, ['D', 'A', 'B', 'C']],
        ['after an anchor', 'A', 'C', ['B', 'C', 'A', 'D']],
        ['upwards after an anchor', 'D', 'A', ['A', 'D', 'B', 'C']],
        ['after the last task', 'B', 'D', ['A', 'C', 'D', 'B']],
        ['after its current predecessor (stays put)', 'C', 'B', ['A', 'B', 'C', 'D']],
        ['the top task to the top (stays put)', 'A', null, ['A', 'B', 'C', 'D']],
      ])('moves a task %s', async (_label, moved, anchor, expected) => {
        const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B', 'C', 'D']);

        const result = await tasks.moveAfter(
          userId,
          byTitle(moved).id,
          anchor === null ? null : byTitle(anchor).id,
          keyBetween,
          LATER,
        );

        expect(result).toMatchObject({ id: byTitle(moved).id, updatedAt: LATER });
        expect(await titlesInOrder()).toEqual(expected);
      });

      it('writes only the moved row', async () => {
        const { tasks, userId, byTitle } = await seed(['A', 'B', 'C']);

        await tasks.moveAfter(userId, byTitle('A').id, byTitle('C').id, keyBetween, LATER);

        expect(plain(await tasks.findById(userId, byTitle('B').id))).toEqual(byTitle('B'));
        expect(plain(await tasks.findById(userId, byTitle('C').id))).toEqual(byTitle('C'));
      });

      it("returns undefined for a missing or another user's anchor, and moves nothing", async () => {
        const { tasks, userId, byTitle, titlesInOrder, createUser } = await seed(['A', 'B']);
        const stranger = await createUser();
        const foreign = await tasks.insertAtTop(stranger, draft({ title: 'Theirs' }), keyBetween);

        expect(
          await tasks.moveAfter(userId, byTitle('A').id, foreign.id, keyBetween, LATER),
        ).toBeUndefined();
        expect(
          await tasks.moveAfter(userId, byTitle('A').id, crypto.randomUUID(), keyBetween, LATER),
        ).toBeUndefined();
        expect(await titlesInOrder()).toEqual(['A', 'B']);
      });

      it("returns undefined when moving another user's task", async () => {
        const { tasks, byTitle, createUser } = await seed(['A', 'B']);
        expect(
          await tasks.moveAfter(await createUser(), byTitle('A').id, null, keyBetween, LATER),
        ).toBeUndefined();
      });

      it('serialises crossed concurrent moves into one of the two serial orders', async () => {
        // X after A and A after X at the same time. Run one after the other, they give
        // X,A,B,C or B,A,X,C; interleaved reads (no per-user lock) give an order neither yields.
        const serialOrders = [
          ['X', 'A', 'B', 'C'],
          ['B', 'A', 'X', 'C'],
        ];
        for (let round = 0; round < 10; round += 1) {
          const { tasks, userId, byTitle, titlesInOrder } = await seed(['A', 'B', 'X', 'C']);
          const [a, x] = [byTitle('A').id, byTitle('X').id];
          // Two concurrent reads first, so a pooled adapter has two warm connections and both
          // moves really run at the same time.
          await Promise.all([tasks.list(userId), tasks.list(userId)]);

          const moves = await Promise.allSettled([
            tasks.moveAfter(userId, x, a, keyBetween, LATER),
            tasks.moveAfter(userId, a, x, keyBetween, LATER),
          ]);

          expect(moves.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
          expect(serialOrders).toContainEqual(await titlesInOrder());
        }
      });

      it('rejects a position collision with CONFLICT and keeps the old position', async () => {
        const { tasks, userId, byTitle } = await seed(['A', 'B', 'C']);
        const collide: KeyBetween = () => byTitle('B').position;

        await expect(
          tasks.moveAfter(userId, byTitle('A').id, byTitle('C').id, collide, LATER),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(plain(await tasks.findById(userId, byTitle('A').id))).toEqual(byTitle('A'));
      });
    });
  });
};

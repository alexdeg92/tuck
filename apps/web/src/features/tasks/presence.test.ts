import { Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../test/fixtures';
import { endPhase, initialPresence, mergeRows, nextPresence, type Presence } from './presence';

const base = Task.parse(fixtures.task);
const make = (n: number, status: 'todo' | 'done' = 'todo'): Task => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Task ${String(n)}`,
  status,
});
const done = (task: Task): Task => ({ ...task, status: 'done' });
const [a, b, c] = [make(1), make(2), make(3)];

const start = (open: Task[], completed: Task[] = [], q = ''): Presence =>
  initialPresence(open, completed, q);

describe('row presence', () => {
  it('starts with no phases and no ghosts: the first render never animates', () => {
    const presence = start([a, b]);
    expect(presence.phases).toEqual({});
    expect(presence.ghosts).toEqual([]);
  });

  it('marks a task that appears in the same list as created, without replaying an entry', () => {
    const presence = nextPresence(start([a]), [c, a], [], '');
    expect(presence.phases).toEqual({ [c.id]: 'created' });
  });

  it('keeps a deleted row as a leaving ghost at its old place, owned by the list', () => {
    const presence = nextPresence(start([a, b, c]), [a, c], [], '');
    expect(presence.ghosts).toEqual([
      {
        key: `${b.id}:open`,
        task: b,
        group: 'open',
        index: 1,
        phase: 'leaving',
        exit: 'delete',
        fromX: 0,
      },
    ]);
    expect(mergeRows([a, c], presence, 'open').map((row) => row.task.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
  });

  it('completes in place: a checked ghost stays in the open list, then sinks and collapses', () => {
    const completed = nextPresence(start([a, b]), [b], [done(a)], '');
    expect(completed.ghosts).toEqual([
      {
        key: `${a.id}:open`,
        task: done(a),
        group: 'open',
        index: 0,
        phase: 'completing',
        exit: 'complete',
        fromX: 0,
      },
    ]);
    expect(completed.phases).toEqual({ [a.id]: 'entering' });
    expect(completed.received).toBe(true);

    const sinking = endPhase(completed, `${a.id}:open`, 'completing');
    expect(sinking.ghosts[0]?.phase).toBe('leaving');
    const gone = endPhase(sinking, `${a.id}:open`, 'leaving');
    expect(gone.ghosts).toEqual([]);
    expect(gone.received).toBe(false);
  });

  it('reopens with the inverse entry, and the done row leaves its group', () => {
    const presence = nextPresence(start([b], [done(a)]), [a, b], [], '');
    expect(presence.phases).toEqual({ [a.id]: 'entering' });
    expect(presence.ghosts.map((ghost) => [ghost.group, ghost.phase, ghost.exit])).toEqual([
      ['done', 'leaving', 'complete'],
    ]);
  });

  it('restores a row whose delete failed, and drops its ghost', () => {
    const deleted = nextPresence(start([a, b]), [a], [], '');
    const restored = nextPresence(deleted, [a, b], [], '');
    expect(restored.ghosts).toEqual([]);
    expect(restored.phases).toEqual({ [b.id]: 'restored' });
  });

  it('cancels a completion that is undone at once: the row comes back, the ghost goes', () => {
    const completed = nextPresence(start([a]), [], [done(a)], '');
    const undone = nextPresence(completed, [a], [], '');
    expect(undone.ghosts).toEqual([]);
    expect(undone.phases[a.id]).toBe('entering');
  });

  it('replaces, not stacks, the ghost of a row that leaves twice', () => {
    const once = nextPresence(start([a, b]), [b], [done(a)], '');
    const back = nextPresence(once, [a, b], [], '');
    const twice = nextPresence(back, [b], [done(a)], '');
    expect(twice.ghosts.filter((ghost) => ghost.task.id === a.id)).toHaveLength(1);
  });

  it('never animates a new search: rows come and go with the query', () => {
    const presence = nextPresence(start([a, b, c]), [b], [], 'two');
    expect(presence.ghosts).toEqual([]);
    expect(presence.phases).toEqual({});
  });

  it('clears a phase when its animation ends', () => {
    const created = nextPresence(start([a]), [c, a], [], '');
    expect(endPhase(created, c.id, 'created').phases).toEqual({});

    expect(endPhase(created, c.id, 'entering')).toBe(created);
  });

  it('returns the same object when nothing changed, so memoized rows stay put', () => {
    const presence = start([a, b]);
    expect(nextPresence(presence, [a, b], [], '')).toBe(presence);
  });

  it('starts a swiped row ghost from where the finger left it, then forgets the offset', () => {
    const swiped = { ...start([a, b]), swipe: { id: a.id, x: 110 } };
    const completed = nextPresence(swiped, [b], [done(a)], '');
    expect(completed.ghosts[0]?.fromX).toBe(110);
    expect(completed.swipe).toBeNull();

    const back = nextPresence(completed, [a, b], [], '');
    const again = nextPresence(back, [b], [done(a)], '');
    expect(again.ghosts[0]?.fromX).toBe(0);
  });

  it('starts a swiped-away (deleted) row ghost from the release offset too, then forgets it', () => {
    const swiped = { ...start([a, b]), swipe: { id: a.id, x: 120 } };
    const deleted = nextPresence(swiped, [b], [], '');
    expect(deleted.ghosts[0]).toMatchObject({ exit: 'delete', fromX: 120 });
    expect(deleted.swipe).toBeNull();
  });
});

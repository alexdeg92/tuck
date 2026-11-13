import type { Task, TaskId } from '@todo/contracts';

export type Group = 'open' | 'done';
export type RowPhase = 'created' | 'entering' | 'restored';
export type GhostPhase = 'completing' | 'leaving';

export type Ghost = {
  key: string;
  task: Task;
  group: Group;

  index: number;
  phase: GhostPhase;
  exit: 'complete' | 'delete';

  fromX: number;
};

export type Presence = {
  open: Task[];
  done: Task[];
  q: string;
  phases: Partial<Record<TaskId, RowPhase>>;
  ghosts: Ghost[];

  removed: TaskId[];

  received: boolean;

  swipe: { id: TaskId; x: number } | null;
};

export type Row = { key: string; task: Task; ghost: Ghost | null };

const withReceived = (presence: Omit<Presence, 'received'>): Presence => ({
  ...presence,
  received: presence.ghosts.some((ghost) => ghost.group === 'open' && ghost.exit === 'complete'),
});

export function initialPresence(open: Task[], done: Task[], q: string): Presence {
  return withReceived({ open, done, q, phases: {}, ghosts: [], removed: [], swipe: null });
}

const sameRows = (a: Task[], b: Task[]) =>
  a.length === b.length && a.every((task, index) => task === b[index]);

export function mergeRows(tasks: Task[], presence: Presence, group: Group): Row[] {
  const rows: Row[] = tasks.map((task) => ({ key: task.id, task, ghost: null }));
  const ghosts = presence.ghosts
    .filter((ghost) => ghost.group === group)
    .sort((left, right) => left.index - right.index);
  for (const ghost of ghosts) {
    rows.splice(Math.min(ghost.index, rows.length), 0, {
      key: ghost.key,
      task: ghost.task,
      ghost,
    });
  }
  return rows;
}

export function nextPresence(previous: Presence, open: Task[], done: Task[], q: string): Presence {
  if (q !== previous.q) return { ...initialPresence(open, done, q), swipe: previous.swipe };
  if (sameRows(open, previous.open) && sameRows(done, previous.done)) return previous;

  const ids = (tasks: Task[]) => new Set(tasks.map((task) => task.id));
  const next = { open: ids(open), done: ids(done) };
  const before = { open: ids(previous.open), done: ids(previous.done) };
  const phases: Presence['phases'] = { ...previous.phases };
  const removed = new Set(previous.removed);
  let swipe = previous.swipe;

  let ghosts = previous.ghosts.filter((ghost) => !next[ghost.group].has(ghost.task.id));

  const leave = (task: Task, group: Group) => {
    const other: Group = group === 'open' ? 'done' : 'open';
    const moved = next[other].has(task.id);

    if (group === 'done' && moved && previous.phases[task.id] !== undefined) return;
    const rendered = mergeRows(previous[group], previous, group);
    const key = `${task.id}:${group}`;
    const ghost: Ghost = {
      key,
      task: moved ? ((group === 'open' ? done : open).find((t) => t.id === task.id) ?? task) : task,
      group,
      index: rendered.findIndex((row) => row.key === task.id),
      phase: moved && group === 'open' ? 'completing' : 'leaving',
      exit: moved ? 'complete' : 'delete',
      fromX: swipe?.id === task.id ? swipe.x : 0,
    };
    if (swipe?.id === task.id) swipe = null;
    ghosts = [...ghosts.filter((existing) => existing.key !== key), ghost];
    if (!moved) removed.add(task.id);
  };

  const arrive = (task: Task, group: Group) => {
    const other: Group = group === 'open' ? 'done' : 'open';
    if (before[other].has(task.id)) {
      phases[task.id] = 'entering';
    } else if (removed.has(task.id)) {
      phases[task.id] = 'restored';
      removed.delete(task.id);
    } else {
      phases[task.id] = 'created';
    }
  };

  for (const group of ['open', 'done'] as const) {
    for (const task of previous[group]) if (!next[group].has(task.id)) leave(task, group);
    for (const task of group === 'open' ? open : done) {
      if (!before[group].has(task.id)) arrive(task, group);
    }
  }

  return withReceived({ open, done, q, phases, ghosts, removed: [...removed], swipe });
}

export function endPhase(presence: Presence, key: string, phase: string): Presence {
  const ghost = presence.ghosts.find((candidate) => candidate.key === key);
  if (ghost !== undefined) {
    if (ghost.phase !== phase) return presence;
    const ghosts =
      ghost.phase === 'completing'
        ? presence.ghosts.map((candidate) =>
            candidate === ghost ? { ...candidate, phase: 'leaving' as const } : candidate,
          )
        : presence.ghosts.filter((candidate) => candidate !== ghost);
    return withReceived({ ...presence, ghosts });
  }
  if (presence.phases[key] !== phase) return presence;
  const phases = Object.fromEntries(
    Object.entries(presence.phases).filter(([id]) => id !== key),
  ) as Presence['phases'];
  return { ...presence, phases };
}

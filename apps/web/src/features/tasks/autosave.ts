import { TaskConflictError, type Task, type TaskId } from '@todo/contracts';
import { isApiRequestError } from '../../shared/lib/apiError';
import { nextDraftRevision, type DraftSlot } from './drafts';

/**
 * Autosave for a task's title and notes, without React: one saver per open task.
 *
 * - `edit` records the latest valid values (Editing…) and saves them 700 ms after typing stops
 *   (Saving…); `flush` saves at once (blur, task switch, page hidden).
 * - One request is in flight per task. Edits made meanwhile are coalesced into the next save,
 *   which is based on the previous save's new `updatedAt`.
 * - Every save sends `expectedUpdatedAt`. A 409 whose current title and notes are still what this
 *   save started from (only priority, status or the due date changed elsewhere) is resent at once
 *   on the new version. Otherwise the saver stops and asks: Keep mine or Use theirs.
 * - A newer server copy (`adopt`) replaces the fields the user has not changed. A field the user
 *   changed keeps the user's text; if the server changed it too, the next save finds the conflict.
 * - With a draft slot, unsent text is also kept in localStorage (see drafts.ts) and restored on
 *   the next visit; it is removed once that text is saved.
 * - A failed save retries with backoff (1 s, 2 s, 4 s … 30 s); offline saves resume when the
 *   browser is back online. A response never overwrites what the user typed.
 */

export type NoteFields = { title: string; notes: string };

export type SaveRequest = {
  id: TaskId;
  changes: Partial<NoteFields>;
  expectedUpdatedAt: string;
  keepalive: boolean;
};

export type SaveState =
  | { kind: 'saved' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'restored' }
  | { kind: 'offline' }
  | { kind: 'failed' }
  | { kind: 'retrying' }
  | { kind: 'conflict'; theirs: Task };

export type NoteSaver = {
  fields: () => NoteFields;

  edit: (fields: Partial<NoteFields>) => void;

  adopt: (server: Task) => Partial<NoteFields> | undefined;

  flush: (options?: { keepalive?: boolean }) => Promise<void>;

  setComposing: (composing: boolean) => void;

  retry: () => void;

  keepMine: () => void;

  useTheirs: () => NoteFields;
  getState: () => SaveState;

  isDurable: () => boolean;

  hasUnsaved: () => boolean;
  subscribe: (listener: () => void) => () => void;

  register: () => () => void;

  discard: () => void;
};

export const SAVE_DELAY_MS = 700;
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

const active = new Set<NoteSaver>();

export async function flushPendingSaves(): Promise<void> {
  const savers = [...active];
  await Promise.all(savers.map((saver) => saver.flush()));
  if (savers.some((saver) => saver.hasUnsaved())) {
    throw new Error('Some notes are not saved yet');
  }
}

export function hasUnsavedNotes(): boolean {
  return [...active].some((saver) => saver.hasUnsaved());
}

export function discardPendingSaves(): void {
  for (const saver of active) saver.discard();
  active.clear();
}

let listening = false;

function listenToPage() {
  if (listening) return;
  listening = true;
  const flushAll = () => {
    for (const saver of active) void saver.flush({ keepalive: true });
  };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('online', () => {
    for (const saver of active) saver.retry();
  });
}

function conflictOf(error: unknown): Task | undefined {
  if (!isApiRequestError(error) || error.status !== 409) return undefined;
  const parsed = TaskConflictError.safeParse(error.body);
  return parsed.success ? parsed.data.error.current : undefined;
}

function isTransient(error: unknown): boolean {
  if (!isApiRequestError(error)) return true;

  return error.unavailable || error.status >= 500 || error.status === 408 || error.status === 429;
}

type Outcome = 'sent' | 'rebased' | 'stopped';
type Base = NoteFields & { updatedAt: string };

const baseOf = (task: Task): Base => ({
  title: task.title,
  notes: task.notes,
  updatedAt: task.updatedAt,
});

export function createNoteSaver({
  task,
  send,
  onSaved,
  drafts,
  delayMs = SAVE_DELAY_MS,
}: {
  task: Task;
  send: (request: SaveRequest) => Promise<Task>;

  onSaved: (task: Task) => void;

  drafts?: DraftSlot | undefined;
  delayMs?: number;
}): NoteSaver {
  const stored = drafts?.read();

  let base: Base = stored?.base ?? baseOf(task);

  let draft: NoteFields = stored
    ? { title: stored.title, notes: stored.notes }
    : { title: task.title, notes: task.notes };

  let restored = stored !== undefined;

  let rev = stored?.rev ?? 0;
  let durable = true;
  let inFlight: Promise<Outcome> | null = null;
  let problem: 'failed' | 'offline' | null = null;
  let theirs: Task | null = null;
  let attempts = 0;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let mounted = 0;
  let discarded = false;
  let composing = false;
  let retrying = false;
  const listeners = new Set<() => void>();

  const changes = (): Partial<NoteFields> => ({
    ...(draft.title !== base.title ? { title: draft.title } : {}),
    ...(draft.notes !== base.notes ? { notes: draft.notes } : {}),
  });
  const dirty = () => Object.keys(changes()).length > 0;

  function persist() {
    if (!drafts || discarded) return;
    const newer = (drafts.read()?.rev ?? -1) > rev;
    if (newer) return;
    if (dirty() || theirs !== null) {
      durable = drafts.write({ title: draft.title, notes: draft.notes, base, rev });
    } else {
      drafts.remove();
    }
  }

  function computeState(): SaveState {
    if (theirs !== null) return { kind: 'conflict', theirs };
    if (retrying) return { kind: 'retrying' };
    if (problem !== null) return { kind: problem };

    if (restored && (dirty() || inFlight !== null)) return { kind: 'restored' };
    if (inFlight !== null) return { kind: 'saving' };
    return dirty() ? { kind: 'editing' } : { kind: 'saved' };
  }
  let snapshot: SaveState = computeState();

  function emit() {
    const next = computeState();
    const same =
      next.kind === snapshot.kind &&
      (next.kind !== 'conflict' ||
        (snapshot.kind === 'conflict' && next.theirs === snapshot.theirs));
    if (same) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function settleIfReleased() {
    if (mounted === 0 && !dirty() && inFlight === null) active.delete(saver);
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = Math.min(RETRY_FIRST_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      void saver.flush();
    }, delay);
  }

  async function sendOnce(keepalive: boolean): Promise<Outcome> {
    const sent = { ...draft };
    try {
      const saved = await send({
        id: task.id,
        changes: changes(),
        expectedUpdatedAt: base.updatedAt,
        keepalive,
      });
      if (discarded) return 'stopped';
      base = baseOf(saved);

      if (draft.title === sent.title && draft.notes === sent.notes) {
        draft = { title: saved.title, notes: saved.notes };
      }
      attempts = 0;
      problem = null;
      restored = false;

      persist();
      onSaved(saved);
      return 'sent';
    } catch (error) {
      if (discarded) return 'stopped';
      const current = conflictOf(error);
      if (current !== undefined) {
        const progressed = current.updatedAt !== base.updatedAt;
        if (progressed && current.title === base.title && current.notes === base.notes) {
          base = { ...base, updatedAt: current.updatedAt };
          persist();
          onSaved(current);
          return 'rebased';
        }
        theirs = current;
        return 'stopped';
      }
      if (isApiRequestError(error) && error.status === 404) {
        draft = { title: base.title, notes: base.notes };
        restored = false;
        persist();
        return 'stopped';
      }
      attempts += 1;
      problem = !navigator.onLine ? 'offline' : 'failed';
      if (isTransient(error)) scheduleRetry();
      return 'stopped';
    }
  }

  const saver: NoteSaver = {
    fields: () => ({ ...draft }),

    edit(fields) {
      if (discarded || composing) return;
      const next = { ...draft, ...fields };
      if (next.title !== draft.title || next.notes !== draft.notes) {
        drafts?.read();
        rev = nextDraftRevision();
      }
      draft = next;
      clearTimeout(typingTimer);
      if (theirs === null && dirty()) {
        typingTimer = setTimeout(() => {
          void saver.flush();
        }, delayMs);
      }
      persist();
      emit();
    },

    adopt(server) {
      const newer = Date.parse(server.updatedAt) > Date.parse(base.updatedAt);
      if (discarded || inFlight !== null || !newer) return undefined;
      const shown: Partial<NoteFields> = {};
      const next: Base = { ...base, updatedAt: server.updatedAt };
      let clash = false;
      for (const field of ['title', 'notes'] as const) {
        if (draft[field] === base[field]) {
          if (server[field] !== draft[field]) shown[field] = server[field];
          draft[field] = server[field];
          next[field] = server[field];
        } else if (server[field] !== base[field]) {
          clash = true;
        }
      }

      base = clash ? { ...next, updatedAt: base.updatedAt } : next;
      persist();
      emit();
      return shown;
    },

    async flush({ keepalive = false } = {}) {
      if (composing && !keepalive) return;
      clearTimeout(typingTimer);
      for (;;) {
        if (discarded) return;
        if (inFlight !== null) {
          if ((await inFlight) === 'stopped') return;
          continue;
        }
        if (theirs !== null || !dirty()) {
          settleIfReleased();
          return;
        }
        clearTimeout(retryTimer);

        if (problem !== null) {
          problem = null;
          retrying = true;
        }
        inFlight = sendOnce(keepalive);
        emit();
        const outcome = await inFlight;
        inFlight = null;
        retrying = false;
        emit();
        if (outcome === 'stopped') return;
      }
    },

    setComposing(next) {
      composing = next;
      if (composing) clearTimeout(typingTimer);
    },

    retry() {
      if (problem === null || inFlight !== null) return;
      clearTimeout(retryTimer);
      void saver.flush();
    },

    keepMine() {
      if (theirs === null) return;
      base = baseOf(theirs);
      theirs = null;
      persist();
      emit();
      void saver.flush();
    },

    useTheirs() {
      const adopted = theirs ?? task;
      base = baseOf(adopted);
      draft = { title: adopted.title, notes: adopted.notes };
      theirs = null;
      problem = null;
      restored = false;
      clearTimeout(typingTimer);
      persist();
      onSaved(adopted);
      emit();
      return { ...draft };
    },

    getState: () => snapshot,
    isDurable: () => durable,
    hasUnsaved: () => !discarded && (dirty() || theirs !== null),

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    register() {
      mounted += 1;
      active.add(saver);
      listenToPage();

      if (restored) void saver.flush();
      return () => {
        mounted -= 1;
        if (mounted === 0) void saver.flush();
      };
    },

    discard() {
      discarded = true;
      clearTimeout(typingTimer);
      clearTimeout(retryTimer);
      draft = { title: base.title, notes: base.notes };
      theirs = null;
      problem = null;
    },
  };

  return saver;
}

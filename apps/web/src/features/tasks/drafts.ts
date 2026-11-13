import { z } from 'zod';

const PREFIX = 'tuck:draft:v1:';

const Base = z.object({
  title: z.string().max(200),
  notes: z.string().max(5000),
  updatedAt: z.iso.datetime(),
});

const StoredDraft = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000),
  base: Base,

  rev: z.number().int().nonnegative().default(0),
});
export type StoredDraft = z.output<typeof StoredDraft>;

export type DraftSlot = {
  read: () => StoredDraft | undefined;

  write: (draft: StoredDraft) => boolean;
  remove: () => void;
};

let lastRevision = 0;

export function nextDraftRevision(): number {
  lastRevision = Math.max(Date.now(), lastRevision + 1);
  return lastRevision;
}

export function observeDraftRevision(rev: number): void {
  lastRevision = Math.max(lastRevision, rev);
}

export const draftKey = (userId: string, taskId: string): string => `${PREFIX}${userId}:${taskId}`;

export function draftSlot(userId: string, taskId: string): DraftSlot {
  const key = draftKey(userId, taskId);
  return {
    read: () => {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return undefined;
        const parsed = StoredDraft.safeParse(JSON.parse(raw));
        if (!parsed.success) return undefined;
        observeDraftRevision(parsed.data.rev);
        return parsed.data;
      } catch {
        return undefined;
      }
    },
    write: (draft) => {
      try {
        localStorage.setItem(key, JSON.stringify(draft));
        return true;
      } catch {
        return false;
      }
    },
    remove: () => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Intentionally ignored.
      }
    },
  };
}

export function clearDrafts(userId: string): void {
  try {
    const own = `${PREFIX}${userId}:`;
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    for (const key of keys) {
      if (key?.startsWith(own) === true) localStorage.removeItem(key);
    }
  } catch {
    // Intentionally ignored.
  }
}

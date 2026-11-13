/**
 * A task's `updatedAt` is also its write version (PATCH's `expectedUpdatedAt` compares it), so
 * every write must move it forward: the clock's time, or 1 ms after the stored stamp when the
 * clock has not moved (two writes in one millisecond) or went back.
 */
export const nextUpdatedAt = (stored: string, now: string): string =>
  new Date(Math.max(Date.parse(now), Date.parse(stored) + 1)).toISOString();

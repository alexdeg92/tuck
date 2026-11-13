const DAY_MS = 24 * 60 * 60 * 1000;

const fullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' });

/** Display only: the server's purgeAt decides when a task is actually deleted. */
export function purgeLabel(
  purgeAt: string,
  now = new Date(),
): { text: string; today: boolean; full: string } {
  const days = Math.ceil(Math.max(0, Date.parse(purgeAt) - now.getTime()) / DAY_MS);
  const today = days <= 1;
  return {
    text: today ? 'Deletes today' : `Deletes in ${String(days)} days`,
    today,
    full: `Deleted for good on ${fullDate.format(new Date(purgeAt))}`,
  };
}

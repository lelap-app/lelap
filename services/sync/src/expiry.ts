import type { SyncStore } from './store';

const DAY_MS = 24 * 60 * 60_000;

/**
 * How long a group may go without a push, from `SYNC_IDLE_EXPIRY_DAYS`. Unset, empty or 0 means
 * never, the default for self-hosters; anything else that is not a whole number of days too, so a
 * typo never deletes groups.
 */
export function idleExpiryMs(days: string | undefined): number | null {
  const text = days?.trim() ?? '';
  if (!/^\d+$/.test(text)) {
    if (text) console.warn(`SYNC_IDLE_EXPIRY_DAYS is not a whole number of days: ${text}`);
    return null;
  }
  const value = Number(text);
  return value > 0 ? value * DAY_MS : null;
}

/** The scheduled job: forgets old pairings, and idle groups when an expiry is set. */
export async function runUpkeep(
  store: SyncStore,
  expiryDays: string | undefined,
  now: number,
): Promise<{ expired: number }> {
  await store.dropExpiredPairings(now);
  const expiry = idleExpiryMs(expiryDays);
  if (expiry === null) return { expired: 0 };
  return { expired: await store.expireIdle(now - expiry) };
}

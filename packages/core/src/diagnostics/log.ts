import { asc, desc, eq, notInArray } from 'drizzle-orm';

import type { Db } from '../db';
import { diagnostics, syncState } from '../schema';
import { DiagnosticEvent } from './events';

/** Events kept: the oldest go when more arrive. A full log exports to roughly 50 KB. */
export const DIAGNOSTICS_LIMIT = 500;

// A device setting, not a profile's: it lives beside the active profile in `sync_state`.
const KEY = 'diagnostics';

export type StoredDiagnostic = { at: number; event: DiagnosticEvent };

export function diagnosticsOn(db: Db): boolean {
  return db.select().from(syncState).where(eq(syncState.key, KEY)).get()?.value === 'on';
}

/** Turns the log on or off. Off empties it, so nothing is left behind. */
export function setDiagnosticsOn(db: Db, on: boolean, now: number): void {
  db.transaction((tx) => {
    if (on) {
      tx.insert(syncState)
        .values({ key: KEY, value: 'on', updatedAt: now })
        .onConflictDoUpdate({ target: syncState.key, set: { value: 'on', updatedAt: now } })
        .run();
    } else {
      tx.delete(syncState).where(eq(syncState.key, KEY)).run();
      tx.delete(diagnostics).run();
    }
  });
}

/** Adds an event when the log is on. Anything that is not a known event is dropped. */
export function recordDiagnostic(db: Db, event: DiagnosticEvent, at: number): boolean {
  if (!diagnosticsOn(db)) return false;
  const parsed = DiagnosticEvent.safeParse(event);
  if (!parsed.success || !Number.isFinite(at)) return false;
  db.transaction((tx) => {
    tx.insert(diagnostics)
      .values({ at: Math.round(at), event: JSON.stringify(parsed.data) })
      .run();
    // By time, as the log is read: the player's events arrive later than they happened.
    tx.delete(diagnostics)
      .where(
        notInArray(
          diagnostics.id,
          tx
            .select({ id: diagnostics.id })
            .from(diagnostics)
            .orderBy(desc(diagnostics.at), desc(diagnostics.id))
            .limit(DIAGNOSTICS_LIMIT),
        ),
      )
      .run();
  });
  return true;
}

/** The log, oldest first. Rows that no longer read as an event are skipped. */
export function listDiagnostics(db: Db): StoredDiagnostic[] {
  const rows = db
    .select()
    .from(diagnostics)
    .orderBy(asc(diagnostics.at), asc(diagnostics.id))
    .all();
  return rows.flatMap((row) => {
    try {
      const parsed = DiagnosticEvent.safeParse(JSON.parse(row.event));
      return parsed.success ? [{ at: row.at, event: parsed.data }] : [];
    } catch {
      return [];
    }
  });
}

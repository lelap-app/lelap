import { z } from 'zod';

import type { InstalledAddon } from './addons/client';
import type { Db } from './db';
import { getBook } from './library/queries';
import { type TimelineFile, toBookPosition } from './library/timeline';
import { deviceValue, setDeviceValue } from './profiles';
import { enqueueScrobble, scrobbleEventFor } from './scrobble';
import { recordListening } from './stats';

// On Android the playback service counts listening time and scrobble sessions (M51), so what it
// hears with the app closed counts too, and nothing is counted twice: the app no longer counts on
// Android. Here its records are merged into the stats and the scrobble outbox, each exactly once.

const Listen = z.object({
  seq: z.number().int(),
  kind: z.literal('listen'),
  bookId: z.string().min(1),
  title: z.string(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ms: z.number().nonnegative(),
});

const SessionEvent = z.object({
  seq: z.number().int(),
  kind: z.enum(['start', 'progress', 'pause']),
  bookId: z.string().min(1),
  at: z.number().nonnegative(),
  fileLocation: z.string(),
  filePositionMs: z.number(),
  startLocation: z.string().nullable(),
  startPositionMs: z.number().nullable(),
});

const AccountingRecord = z.discriminatedUnion('kind', [Listen, SessionEvent]);

/** What the playback service heard; same shape as `ServiceAccounting` in `@lelap/audio`. */
export type ServiceAccounting = {
  epoch: string;
  records: z.input<typeof AccountingRecord>[];
};

/** Device value: the service's epoch and the highest record of it merged here. */
const MERGED_KEY = 'serviceAccountingMerged';

function mergedThrough(db: Db, epoch: string): number {
  try {
    const stored = JSON.parse(deviceValue(db, MERGED_KEY) ?? 'null') as {
      epoch?: unknown;
      seq?: unknown;
    } | null;
    return stored?.epoch === epoch && typeof stored.seq === 'number' ? stored.seq : 0;
  } catch {
    return 0;
  }
}

export type AccountingMerge = {
  /** The highest record of the batch, for the service to drop; null for an empty batch. */
  through: number | null;
  /** Listening time added to the stats. */
  listenedMs: number;
  /** Scrobble events put in the outbox. */
  scrobbles: number;
};

/**
 * Adds a batch from the playback service to `profileId`'s stats and the outbox of the add-ons in
 * `addons`, and remembers how far it got, all in one transaction. Records already merged (the app
 * stopped before it could acknowledge them) and records that don't parse are skipped, so the
 * returned `through` can always be acknowledged.
 */
export function mergeServiceAccounting(
  db: Db,
  args: { profileId: string; batch: ServiceAccounting; addons: InstalledAddon[]; now: number },
): AccountingMerge {
  const { profileId, batch, addons, now } = args;
  const result: AccountingMerge = { through: null, listenedMs: 0, scrobbles: 0 };
  if (!batch.epoch || batch.records.length === 0) return result;
  const through = Math.max(...batch.records.map((r) => (Number.isInteger(r.seq) ? r.seq : 0)));
  db.transaction((tx) => {
    const merged = mergedThrough(tx, batch.epoch);
    const timelines = new Map<string, TimelineFile[]>();
    const bookPosition = (bookId: string, location: string, positionMs: number) => {
      let files = timelines.get(bookId);
      if (!files) {
        files = getBook(tx, profileId, bookId)?.files ?? [];
        timelines.set(bookId, files);
      }
      // A file the book no longer has (a rescan replaced it): no place to report.
      if (!files.some((f) => f.location === location)) return null;
      return toBookPosition(files, location, positionMs);
    };
    const records = batch.records
      .filter((r) => r.seq > merged)
      .sort((a, b) => a.seq - b.seq)
      .flatMap((r) => {
        const parsed = AccountingRecord.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      });
    for (const record of records) {
      if (record.kind === 'listen') {
        recordListening(tx, profileId, record);
        result.listenedMs += record.ms;
        continue;
      }
      const positionMs = bookPosition(record.bookId, record.fileLocation, record.filePositionMs);
      if (positionMs === null) continue;
      const sessionStartMs =
        record.startLocation !== null && record.startPositionMs !== null
          ? bookPosition(record.bookId, record.startLocation, record.startPositionMs)
          : null;
      const event = scrobbleEventFor(tx, {
        event: record.kind,
        bookId: record.bookId,
        at: record.at,
        positionMs,
        ...(sessionStartMs !== null ? { sessionStartMs } : {}),
      });
      if (!event) continue;
      // Named after the record, so even a second merge could never send it twice.
      const eventId = `lelap-service-${batch.epoch}-${record.seq}`;
      const queued = enqueueScrobble(tx, { profileId, addons, event, newId: () => eventId });
      if (queued) result.scrobbles += 1;
    }
    setDeviceValue(
      tx,
      MERGED_KEY,
      JSON.stringify({ epoch: batch.epoch, seq: Math.max(merged, through) }),
      now,
    );
  });
  result.through = through;
  return result;
}

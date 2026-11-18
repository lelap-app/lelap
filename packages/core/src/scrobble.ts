import {
  type ContentType,
  type ScrobbleEvent,
  type ScrobbleEventName,
  type ScrobbleItem,
  ScrobbleEvent as ScrobbleEventSchema,
  wantsScrobble,
} from '@lelap/sdk';
import { and, asc, eq, lte, notInArray } from 'drizzle-orm';

import { addonBase, type InstalledAddon, REQUEST_TIMEOUT_MS } from './addons/client';
import type { Db } from './db';
import type { IdGenerator } from './ids';
import { bookLinks } from './library/links';
import { books, downloads, episodes, podcasts, scrobbleOutbox } from './schema';

// Scrobbling: what the listener plays is reported to the add-ons that declare `scrobble`. Events
// wait in an outbox on the device and go out in order, so listening offline is reported later
// with its real timestamps. Never with a source, stream or file URL.

/** A POST to an add-on; tests pass a fake. */
export type Poster = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null } }>;

/** Events per request; the protocol allows 100. */
export const SCROBBLE_BATCH = 50;
/** Events older than this are dropped unsent: the add-on has been failing for a month. */
export const SCROBBLE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

/** 30 s, 1 min, 2 min … up to 6 h. */
export function scrobbleBackoff(attempts: number): number {
  return Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

/** What the add-ons hear about a library book; null for a book that is gone. */
export function scrobbleItem(db: Db, bookId: string): ScrobbleItem | null {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (!book) return null;
  const base = {
    name: book.title || 'Untitled',
    ...(book.author ? { author: book.author } : {}),
    ...(book.durationMs > 0 ? { durationMs: book.durationMs } : {}),
  };
  if (book.source === 'feed') {
    const row = db
      .select({
        guid: episodes.guid,
        feed: podcasts.feedUrl,
        podcastGuid: podcasts.guid,
        title: podcasts.title,
      })
      .from(episodes)
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(episodes.bookId, bookId))
      .get();
    return {
      ...base,
      type: 'episode',
      ...(row
        ? {
            episodeGuid: row.guid,
            podcast: {
              feed: row.feed,
              title: row.title,
              ...(row.podcastGuid ? { guid: row.podcastGuid } : {}),
            },
          }
        : {}),
    };
  }
  if (book.source === 'addon' && book.addonItem) {
    const meta = db
      .select({ meta: downloads.meta })
      .from(downloads)
      .where(eq(downloads.bookId, bookId))
      .get()?.meta;
    const type = book.addonItem.type as ContentType;
    return {
      ...base,
      type,
      id: book.addonItem.id,
      ...(meta?.externalIds ? { externalIds: meta.externalIds } : {}),
    };
  }
  // The listener's own files: their title and author, and the work they are linked to (M56), so a
  // tracker can match by Open Library ID, ISBN or ASIN instead of by name.
  const externalIds = linkedIds(db, bookId);
  return { ...base, type: 'audiobook', ...(externalIds ? { externalIds } : {}) };
}

/** `{ ol, isbn, asin }` of the work a library book is linked to, or null. */
function linkedIds(db: Db, bookId: string): Record<string, string> | null {
  const ids: Record<string, string> = {};
  for (const link of bookLinks(db, bookId)) {
    for (const id of [link.workId, ...link.ids]) {
      const at = id.indexOf(':');
      if (at <= 0) continue;
      const prefix = id.slice(0, at);
      if (prefix === 'ol' || prefix === 'isbn' || prefix === 'asin')
        ids[prefix] ??= id.slice(at + 1);
    }
  }
  return Object.keys(ids).length > 0 ? ids : null;
}

/**
 * Puts an event in the outbox for every add-on that wants it. Returns the event, or null when no
 * add-on wants it.
 */
export function enqueueScrobble(
  db: Db,
  args: {
    profileId: string;
    addons: InstalledAddon[];
    event: Omit<ScrobbleEvent, 'eventId'>;
    newId: IdGenerator;
  },
): ScrobbleEvent | null {
  const { profileId, addons, newId } = args;
  const event = { ...args.event, eventId: newId() };
  if (!ScrobbleEventSchema.safeParse(event).success) return null;
  const targets = addons.filter((a) => wantsScrobble(a.manifest, event.item.type, event.item.id));
  if (targets.length === 0) return null;
  db.transaction((tx) => {
    for (const addon of targets) {
      tx.insert(scrobbleOutbox)
        .values({
          eventId: event.eventId,
          addonUrl: addon.url,
          profileId,
          event,
          at: event.at,
          nextAttemptAt: event.at,
        })
        .onConflictDoNothing()
        .run();
    }
  });
  return event;
}

/** When the next event is due, or null when the outbox is empty. */
export function nextScrobbleDue(db: Db): number | null {
  const row = db
    .select({ due: scrobbleOutbox.nextAttemptAt })
    .from(scrobbleOutbox)
    .orderBy(asc(scrobbleOutbox.nextAttemptAt))
    .limit(1)
    .get();
  return row?.due ?? null;
}

export type ScrobbleReport = { sent: number; dropped: number; failed: number };

/** Whether a status means "never send this again" rather than "try later". */
const isPermanent = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

/**
 * Sends what is due, oldest first, one request per add-on at a time. Events for add-ons that are
 * no longer installed, and events a month old, are dropped. An add-on that fails waits longer
 * each time; its events keep their order.
 */
export async function sendScrobbles(
  db: Db,
  post: Poster,
  installed: InstalledAddon[],
  now: number,
): Promise<ScrobbleReport> {
  const report: ScrobbleReport = { sent: 0, dropped: 0, failed: 0 };
  const urls = installed.map((a) => a.url);
  const stale = db
    .delete(scrobbleOutbox)
    .where(urls.length > 0 ? notInArray(scrobbleOutbox.addonUrl, urls) : undefined)
    .returning({ id: scrobbleOutbox.eventId })
    .all();
  const old = db
    .delete(scrobbleOutbox)
    .where(lte(scrobbleOutbox.at, now - SCROBBLE_MAX_AGE_MS))
    .returning({ id: scrobbleOutbox.eventId })
    .all();
  report.dropped += stale.length + old.length;

  for (const url of urls) {
    // Order matters within an add-on, so a later event never overtakes one still waiting.
    for (;;) {
      const rows = db
        .select()
        .from(scrobbleOutbox)
        .where(eq(scrobbleOutbox.addonUrl, url))
        .orderBy(asc(scrobbleOutbox.at), asc(scrobbleOutbox.eventId))
        .limit(SCROBBLE_BATCH)
        .all();
      const first = rows[0];
      if (!first || first.nextAttemptAt > now) break;
      const { status, retryAfterMs } = await postEvents(
        post,
        url,
        rows.map((r) => r.event),
      );
      const ids = rows.map((r) => r.eventId);
      const done = status !== null && (status < 300 || isPermanent(status));
      db.transaction((tx) => {
        for (const id of ids) {
          const where = and(eq(scrobbleOutbox.eventId, id), eq(scrobbleOutbox.addonUrl, url));
          if (done) tx.delete(scrobbleOutbox).where(where).run();
          else
            tx.update(scrobbleOutbox)
              .set({
                attempts: first.attempts + 1,
                // The add-on's own wait, when it said one, if that is longer.
                nextAttemptAt: now + Math.max(scrobbleBackoff(first.attempts + 1), retryAfterMs),
              })
              .where(where)
              .run();
        }
      });
      if (!done) {
        report.failed += ids.length;
        break;
      }
      if (status < 300) report.sent += ids.length;
      else report.dropped += ids.length;
    }
  }
  return report;
}

/** Milliseconds from a `Retry-After` header, in seconds or as a date; at most a day, else 0. */
export function retryAfterMs(value: string | null | undefined, now: number): number {
  const text = (value ?? '').trim();
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 24 * 60 * 60 * 1000)) : 0;
}

/**
 * The status the add-on answered, or null when it could not be reached, and how long it asked to
 * wait before the next try.
 */
async function postEvents(
  post: Poster,
  manifestUrl: string,
  events: ScrobbleEvent[],
): Promise<{ status: number | null; retryAfterMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await post(`${addonBase(manifestUrl)}scrobble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ events }),
      signal: controller.signal,
    });
    const wait = response.headers?.get('Retry-After');
    return { status: response.status, retryAfterMs: retryAfterMs(wait, Date.now()) };
  } catch {
    return { status: null, retryAfterMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Roughly how often a `progress` event goes out while playing. */
export const SCROBBLE_PROGRESS_MS = 5 * 60 * 1000;

/** What the tracker needs from the player. */
export type TrackedState = {
  playing: boolean;
  bookId: string | null;
  /** On the whole-book timeline. */
  positionMs: number;
};

export type TrackedEvent = {
  event: ScrobbleEventName;
  bookId: string;
  at: number;
  positionMs: number;
  sessionStartMs?: number;
};

/**
 * Turns player states into scrobble events: `start` when a book starts playing, `progress` about
 * every five minutes while it plays, `pause` when it stops or another book takes over. `finish`
 * comes from the player's own end-of-book report, through `finished`.
 */
export class ScrobbleTracker {
  private current: {
    bookId: string;
    sessionStartMs: number;
    positionMs: number;
    lastReportAt: number;
  } | null = null;

  update(state: TrackedState, now: number): TrackedEvent[] {
    const out: TrackedEvent[] = [];
    const current = this.current;
    const playing = state.playing && state.bookId !== null;
    if (current && (!playing || state.bookId !== current.bookId)) {
      out.push({
        event: 'pause',
        bookId: current.bookId,
        at: now,
        // Another book has its own position; keep the last one seen for this book.
        positionMs: state.bookId === current.bookId ? state.positionMs : current.positionMs,
        sessionStartMs: current.sessionStartMs,
      });
      this.current = null;
    }
    if (!playing || state.bookId === null) return out;
    if (!this.current) {
      this.current = {
        bookId: state.bookId,
        sessionStartMs: state.positionMs,
        positionMs: state.positionMs,
        lastReportAt: now,
      };
      out.push({ event: 'start', bookId: state.bookId, at: now, positionMs: state.positionMs });
      return out;
    }
    this.current.positionMs = state.positionMs;
    if (now - this.current.lastReportAt >= SCROBBLE_PROGRESS_MS) {
      this.current.lastReportAt = now;
      out.push({
        event: 'progress',
        bookId: state.bookId,
        at: now,
        positionMs: state.positionMs,
        sessionStartMs: this.current.sessionStartMs,
      });
    }
    return out;
  }

  /** The player reached the end of a book at `at`; ends its session. */
  finished(bookId: string, at: number, durationMs: number): TrackedEvent {
    const session = this.current?.bookId === bookId ? this.current : null;
    if (session) this.current = null;
    return {
      event: 'finish',
      bookId,
      at,
      positionMs: durationMs,
      ...(session ? { sessionStartMs: session.sessionStartMs } : {}),
    };
  }
}

/**
 * A `start` this far into a book carries on with it (revision 9 `resumed`): the listener began it
 * before. A start near the beginning is a fresh one, such as listening to a finished book again.
 */
export const RESUMED_AFTER_MS = 30_000;

/** Builds the event for an add-on from a tracked one; null when the book is gone. */
export function scrobbleEventFor(
  db: Db,
  tracked: TrackedEvent,
  extra: { rating?: number } = {},
): Omit<ScrobbleEvent, 'eventId'> | null {
  const item = scrobbleItem(db, tracked.bookId);
  if (!item) return null;
  const resumed = tracked.event === 'start' && tracked.positionMs >= RESUMED_AFTER_MS;
  return {
    event: tracked.event,
    at: Math.round(tracked.at),
    item,
    positionMs: Math.max(0, Math.round(tracked.positionMs)),
    ...(tracked.sessionStartMs !== undefined
      ? { sessionStartMs: Math.max(0, Math.round(tracked.sessionStartMs)) }
      : {}),
    ...(resumed ? { resumed: true } : {}),
    ...extra,
  };
}

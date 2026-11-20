import type { Manifest } from '@lelap/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import type { InstalledAddon } from './addons/client';
import { addStreamedBook } from './addons/streamed';
import { linkBook } from './library/links';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { scrobbleOutbox } from './schema';
import {
  enqueueScrobble,
  nextScrobbleDue,
  type Poster,
  RESUMED_AFTER_MS,
  retryAfterMs,
  SCROBBLE_MAX_AGE_MS,
  SCROBBLE_PROGRESS_MS,
  ScrobbleTracker,
  scrobbleBackoff,
  scrobbleEventFor,
  scrobbleItem,
  sendScrobbles,
} from './scrobble';

const manifest = (resources: Manifest['resources']): Manifest => ({
  id: 'org.example.scrobbler',
  version: '1.0.0',
  protocol: 1,
  name: 'Scrobbler',
  description: '',
  types: ['audiobook', 'episode'],
  resources,
  catalogs: [],
});

const scrobbler: InstalledAddon = {
  id: 'a',
  url: 'https://scrobbler.example/sealed/manifest.json',
  manifest: manifest(['scrobble']),
  builtin: false,
};
const other: InstalledAddon = {
  id: 'b',
  url: 'https://books.example/manifest.json',
  manifest: manifest(['catalog']),
  builtin: false,
};

let n = 0;
const newId = () => `evt-${String(++n).padStart(8, '0')}`;

const event = (at: number) => ({
  event: 'start' as const,
  at,
  item: { type: 'audiobook' as const, name: 'Book' },
  positionMs: 0,
});

const ok: Poster = vi.fn(async () => ({ ok: true, status: 200 }));

describe('enqueueScrobble', () => {
  it('queues one row per add-on that declares scrobble', () => {
    const db = createTestDb();
    const queued = enqueueScrobble(db, {
      profileId: ME,
      addons: [scrobbler, other],
      event: event(1000),
      newId,
    });
    expect(queued?.eventId).toMatch(/^evt-/);
    const rows = db.select().from(scrobbleOutbox).all();
    expect(rows.map((r) => r.addonUrl)).toEqual([scrobbler.url]);
    expect(nextScrobbleDue(db)).toBe(1000);
  });

  it('queues nothing without a scrobbler, or for a type it does not take', () => {
    const db = createTestDb();
    expect(enqueueScrobble(db, { profileId: ME, addons: [other], event: event(1), newId })).toBe(
      null,
    );
    const podcast = { ...event(1), item: { type: 'podcast' as const, name: 'Show' } };
    expect(enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: podcast, newId })).toBe(
      null,
    );
    expect(db.select().from(scrobbleOutbox).all()).toHaveLength(0);
  });
});

describe('resumed', () => {
  const resumedStart = (at: number) => ({ ...event(at), positionMs: 60_000, resumed: true });
  const queuedResumed = (db: ReturnType<typeof createTestDb>) =>
    db.select().from(scrobbleOutbox).all().at(-1)?.event.resumed;
  const refused: Poster = async () => ({ ok: false, status: 400 });

  it('keeps resumed once the add-on has had an event of the book', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    await sendScrobbles(db, ok, [scrobbler], 1);
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: resumedStart(2), newId });
    expect(queuedResumed(db)).toBe(true);
  });

  it('keeps resumed behind an event of the book still waiting', () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: resumedStart(2), newId });
    expect(queuedResumed(db)).toBe(true);
  });

  it('drops resumed when the add-on never got the earlier event', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    await sendScrobbles(db, refused, [scrobbler], 1);
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: resumedStart(2), newId });
    expect(queuedResumed(db)).toBeUndefined();

    const stale = createTestDb();
    enqueueScrobble(stale, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    await sendScrobbles(stale, ok, [scrobbler], SCROBBLE_MAX_AGE_MS + 1);
    enqueueScrobble(stale, {
      profileId: ME,
      addons: [scrobbler],
      event: resumedStart(SCROBBLE_MAX_AGE_MS + 2),
      newId,
    });
    expect(queuedResumed(stale)).toBeUndefined();
  });
});

describe('sendScrobbles', () => {
  it('sends in order with the original timestamps and empties the outbox', async () => {
    const db = createTestDb();
    for (const at of [3000, 1000, 2000])
      enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(at), newId });
    const post = vi.fn<Poster>(async () => ({ ok: true, status: 200 }));

    const report = await sendScrobbles(db, post, [scrobbler], 10_000);

    expect(report).toEqual({ sent: 3, dropped: 0, failed: 0 });
    const [url, init] = post.mock.calls[0] ?? [];
    expect(url).toBe('https://scrobbler.example/sealed/scrobble');
    const body = JSON.parse(init?.body ?? '{}') as { events: { at: number }[] };
    expect(body.events.map((e) => e.at)).toEqual([1000, 2000, 3000]);
    expect(db.select().from(scrobbleOutbox).all()).toHaveLength(0);
  });

  it('keeps events after a failure and waits longer each time', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    const down = vi.fn<Poster>(async () => ({ ok: false, status: 503 }));

    expect((await sendScrobbles(db, down, [scrobbler], 100)).failed).toBe(1);
    expect(nextScrobbleDue(db)).toBe(100 + scrobbleBackoff(1));
    // Not due yet: nothing is sent.
    await sendScrobbles(db, down, [scrobbler], 200);
    expect(down).toHaveBeenCalledTimes(1);

    const offline = vi.fn<Poster>(async () => {
      throw new Error('offline');
    });
    await sendScrobbles(db, offline, [scrobbler], 100 + scrobbleBackoff(1));
    expect(db.select().from(scrobbleOutbox).get()?.attempts).toBe(2);
    expect(scrobbleBackoff(2)).toBe(2 * scrobbleBackoff(1));
    expect(scrobbleBackoff(50)).toBe(6 * 60 * 60 * 1000);
  });

  it('drops events the add-on refuses, and those of removed add-ons', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    const refused = vi.fn<Poster>(async () => ({ ok: false, status: 400 }));
    expect(await sendScrobbles(db, refused, [scrobbler], 1)).toEqual({
      sent: 0,
      dropped: 1,
      failed: 0,
    });

    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    expect((await sendScrobbles(db, ok, [other], 1)).dropped).toBe(1);
    expect(db.select().from(scrobbleOutbox).all()).toHaveLength(0);
  });

  it('retries a 429 rather than dropping it', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    const busy = vi.fn<Poster>(async () => ({ ok: false, status: 429 }));
    expect((await sendScrobbles(db, busy, [scrobbler], 1)).failed).toBe(1);
  });

  it('waits at least as long as the add-on’s Retry-After', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    const busy = vi.fn<Poster>(async () => ({
      ok: false,
      status: 503,
      headers: new Headers({ 'Retry-After': '3600' }),
    }));
    await sendScrobbles(db, busy, [scrobbler], 100);
    expect(nextScrobbleDue(db)).toBe(100 + 3_600_000);
    expect(retryAfterMs('soon', 0)).toBe(0);
    expect(retryAfterMs(new Date(5_000).toUTCString(), 0)).toBe(5_000);
    expect(retryAfterMs('999999', 0)).toBe(24 * 60 * 60 * 1000);
  });

  it('drops events older than a month', async () => {
    const db = createTestDb();
    enqueueScrobble(db, { profileId: ME, addons: [scrobbler], event: event(0), newId });
    const post = vi.fn<Poster>(async () => ({ ok: true, status: 200 }));
    expect((await sendScrobbles(db, post, [scrobbler], SCROBBLE_MAX_AGE_MS + 1)).dropped).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ScrobbleTracker', () => {
  it('reports start, progress about every five minutes, and pause', () => {
    const tracker = new ScrobbleTracker();
    const at = (positionMs: number, playing = true) => ({ playing, bookId: 'b', positionMs });

    expect(tracker.update(at(1000), 0).map((e) => e.event)).toEqual(['start']);
    expect(tracker.update(at(61_000), 60_000)).toEqual([]);
    const [progress] = tracker.update(at(301_000), SCROBBLE_PROGRESS_MS);
    expect(progress).toMatchObject({
      event: 'progress',
      positionMs: 301_000,
      sessionStartMs: 1000,
    });
    const [pause] = tracker.update(at(302_000, false), SCROBBLE_PROGRESS_MS + 1000);
    expect(pause).toMatchObject({ event: 'pause', positionMs: 302_000, sessionStartMs: 1000 });
    expect(tracker.update(at(302_000, false), SCROBBLE_PROGRESS_MS + 2000)).toEqual([]);
  });

  it('pauses the old book when another starts', () => {
    const tracker = new ScrobbleTracker();
    tracker.update({ playing: true, bookId: 'a', positionMs: 10 }, 0);
    tracker.update({ playing: true, bookId: 'a', positionMs: 20 }, 1);
    const events = tracker.update({ playing: true, bookId: 'b', positionMs: 5 }, 2);
    expect(events).toEqual([
      { event: 'pause', bookId: 'a', at: 2, positionMs: 20, sessionStartMs: 10 },
      { event: 'start', bookId: 'b', at: 2, positionMs: 5 },
    ]);
  });

  it('ends the session on finish', () => {
    const tracker = new ScrobbleTracker();
    tracker.update({ playing: true, bookId: 'a', positionMs: 10 }, 0);
    expect(tracker.finished('a', 5, 900)).toEqual({
      event: 'finish',
      bookId: 'a',
      at: 5,
      positionMs: 900,
      sessionStartMs: 10,
    });
    // The player stops after the end; no extra pause.
    expect(tracker.update({ playing: false, bookId: 'a', positionMs: 900 }, 6)).toEqual([]);
  });
});

describe('scrobbleItem', () => {
  it('describes the listener’s own files by title alone, never by path', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Dune', [{ location: 'dune/1.mp3', durationMs: 1000 }]);
    const item = scrobbleItem(db, bookId);
    expect(item).toEqual({ type: 'audiobook', name: 'Dune', durationMs: 1000 });
    expect(JSON.stringify(item)).not.toContain('content://');
  });

  it('gives an add-on book its ID and no stream URL', () => {
    const db = createTestDb();
    const bookId = addStreamedBook(db, {
      addonUrl: 'https://books.example/manifest.json',
      meta: { id: 'ol:OL1W', type: 'audiobook', name: 'Walden', author: 'Thoreau' },
      stream: {
        sourceKey: 'k',
        name: 'Source',
        url: 'https://audio.example/walden.mp3',
        durationMs: 5000,
      },
      now: 0,
      newId: () => 'book-walden',
    });
    const tracked = { event: 'start' as const, bookId, at: 7.4, positionMs: 12.6 };
    const built = scrobbleEventFor(db, tracked);
    expect(built).toEqual({
      event: 'start',
      at: 7,
      positionMs: 13,
      item: {
        type: 'audiobook',
        id: 'ol:OL1W',
        name: 'Walden',
        author: 'Thoreau',
        durationMs: 5000,
      },
    });
    expect(JSON.stringify(built)).not.toContain('audio.example');
  });

  it('gives the listener’s own book the IDs of the work it is linked to', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Dune', [{ location: 'dune/1.mp3', durationMs: 1000 }]);
    linkBook(
      db,
      bookId,
      {
        type: 'audiobook',
        id: 'ol:OL893415W',
        title: 'Dune',
        author: 'Frank Herbert',
        externalIds: { ol: 'OL893415W', asin: 'B002V1OF70' },
        series: null,
      },
      0,
    );
    expect(scrobbleItem(db, bookId)?.externalIds).toEqual({ ol: 'OL893415W', asin: 'B002V1OF70' });
  });

  it('marks a start far into a book as resumed', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Dune', [{ location: 'dune/1.mp3', durationMs: 100_000 }]);
    const start = (positionMs: number) =>
      scrobbleEventFor(db, { event: 'start', bookId, at: 1, positionMs })?.resumed;
    expect(start(0)).toBeUndefined();
    expect(start(RESUMED_AFTER_MS)).toBe(true);
    expect(
      scrobbleEventFor(db, { event: 'pause', bookId, at: 1, positionMs: 90_000 })?.resumed,
    ).toBeUndefined();
  });

  it('is null for a book that is gone', () => {
    expect(scrobbleItem(createTestDb(), 'nope')).toBe(null);
  });
});

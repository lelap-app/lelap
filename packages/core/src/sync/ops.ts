import { normalizeIds } from '@lelap/sdk';
import { and, asc, eq, gt, inArray, like, lte } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { BIG_LIBRARY_PREFIX } from '../bigLibrary';
import { isPlaceholderFeed } from '../podcasts/placeholder';
import { episodeBook } from '../podcasts/repository';
import {
  type AddonItemRef,
  type LinkedMeta,
  bookFiles,
  bookmarks,
  books,
  bookTags,
  chapters,
  episodes,
  hiddenBooks,
  libraryEntries,
  ownChapters,
  listeningLog,
  playlists,
  scrobbleOutbox,
  podcasts,
  profiles,
  progress,
  settings,
  type SmartRule,
  subscriptions,
  tombstones,
  upNext,
  workLinks,
} from '../schema';
import { bookIdForKey, bookKey, parseEpisodeKey, recordDeletion, type TombstoneKind } from './keys';
import { type SoundOverrides, syncedOverrides } from '../sound';
import { cleanChapters } from '../library/ownChapters';
import { cleanOrder, SERIES_ORDER_PREFIX } from '../library/series';
import { cleanRating, RATING_PREFIX } from '../ratings';

/** Where a profile's source choices live in `settings` (see addons/sources.ts). */
const SOURCE_PREFIX = 'source:';

// Covers from another device are web addresses. A file or content address would name something
// on this phone, which the car's exported cover provider must never be pointed at.
const webCover = (url: string | null): string | null =>
  typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;

/** A stored or received source choice, checked: it is only data. */
function sourceChoiceOf(value: unknown): { addonUrl: string; sourceKey: string } | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { addonUrl, sourceKey } = parsed as { addonUrl?: unknown; sourceKey?: unknown };
  if (!isText(addonUrl) || !/^https?:\/\//.test(addonUrl) || !isText(sourceKey, 1024)) return null;
  return { addonUrl, sourceKey };
}

/** Settings that follow the listener between devices; download rules stay with each device. */
export const SYNCED_SETTINGS = [
  'duckOnInterruption',
  'duckPercent',
  'skipIntervalMs',
  'smartRewind',
  'mono',
  'voiceEq',
  'skipSilence',
  'evenLoudness',
];

type Part = {
  location: string;
  uri: string;
  title: string | null;
  durationMs: number;
  size: number;
};

export type BookSnapshot = {
  title: string;
  author: string | null;
  kind: 'folder' | 'file';
  coverUrl: string | null;
  addonItem: AddonItemRef | null;
  durationMs: number;
  parts: Part[];
  chapters: { title: string; startMs: number }[];
};

export type EpisodeSnapshot = {
  podcast: { title: string; author: string | null; coverUrl: string | null };
  title: string;
  url: string;
  mime: string | null;
  size: number;
  durationMs: number;
  publishedAt: number | null;
  season: number | null;
  number: number | null;
};

type Place = {
  fileLocation: string;
  fileIndex: number;
  filePositionMs: number;
  bookPositionMs: number;
};

/** One change. `at` is when it was made; the newest change to a row wins. */
export type Op =
  | { type: 'book'; key: string; at: number; data: BookSnapshot }
  | { type: 'episode'; key: string; at: number; data: EpisodeSnapshot }
  | { type: 'progress'; profile: string; key: string; at: number; data: Place }
  | {
      type: 'entry';
      profile: string;
      key: string;
      at: number;
      /** The book's own sound since M84; absent from older devices, which keep what is here. */
      data: {
        speed: number;
        lastPlayedAt: number | null;
        finishedAt: number | null;
      } & Partial<SoundOverrides>;
    }
  | {
      type: 'bookmark';
      profile: string;
      key: string;
      at: number;
      data: Place & { book: string; note: string | null; createdAt: number };
    }
  | {
      type: 'subscription';
      profile: string;
      key: string;
      at: number;
      data: {
        title: string;
        coverUrl: string | null;
        autoDownload: boolean;
        keepLatest: number;
        /** Since M45; absent from older devices, which then keep what this device has. */
        skipIntroMs?: number;
        skipOutroMs?: number;
        subscribedAt: number;
      } & Partial<SoundOverrides>;
    }
  | {
      type: 'upNext';
      profile: string;
      key: string;
      at: number;
      data: { position: number; addedAt: number };
    }
  | { type: 'setting'; profile: string; key: string; at: number; data: { value: string } }
  | { type: 'tags'; profile: string; key: string; at: number; data: { tags: string[] } }
  | {
      type: 'playlist';
      profile: string;
      key: string;
      at: number;
      data: {
        name: string;
        rule: SmartRule | null;
        items: string[];
        createdAt: number;
        /** Missing from devices before M112. */
        keepFinished?: boolean;
      };
    }
  | {
      type: 'profile';
      key: string;
      at: number;
      data: {
        name: string;
        createdAt: number;
        avatar?: string | null;
        pinHash?: string | null;
        kids?: boolean;
        hiddenAddons?: string[];
      };
    }
  | {
      /** A library book is, or is not, an add-on work (M56). Since M56; older devices skip it. */
      type: 'link';
      /** `<book location>\n<work type>\n<work ID>`. */
      key: string;
      at: number;
      data: {
        book: string;
        workType: string;
        workId: string;
        state: 'linked' | 'rejected';
        ids: string[];
        meta: LinkedMeta | null;
      };
    }
  | {
      /** A book hidden from the library, or said not to be music (M77). Older devices skip it. */
      type: 'hidden';
      profile: string;
      /** The book's location, as for tags. */
      key: string;
      at: number;
      data: { hidden: boolean; notMusic: boolean };
    }
  | {
      /**
       * A profile's own chapters for a book (M85), or null for the book's own again. Older
       * devices skip it.
       */
      type: 'chapters';
      profile: string;
      /** The book's synced name, as for tags. */
      key: string;
      at: number;
      data: { chapters: { title: string; startMs: number }[] | null };
    }
  | {
      /** The source a profile picked for an add-on work (M15). Since M68; older devices skip it. */
      type: 'source';
      profile: string;
      /** `<work type>:<work ID>`, as in the settings key `source:<type>:<id>`. */
      key: string;
      at: number;
      data: { addonUrl: string; sourceKey: string };
    }
  | {
      /** A profile's own order of a series (M109): book keys. Older devices skip it. */
      type: 'seriesOrder';
      profile: string;
      /** The series' key, as `seriesKey` makes it. */
      key: string;
      at: number;
      data: { books: string[] };
    }
  | {
      /** A profile's own rating of a book (M102), or null for none. Older devices skip it. */
      type: 'rating';
      profile: string;
      /** The book's synced name, as for tags. */
      key: string;
      at: number;
      data: { rating: number | null };
    }
  | { type: 'delete'; kind: TombstoneKind; profile: string; key: string; at: number };

function fileIndexOf(db: Db, bookId: string, location: string): number {
  return (
    db
      .select({ idx: bookFiles.idx })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.location, location)))
      .get()?.idx ?? 0
  );
}

/** A place on this device: the same file when it exists here, else the file at that index. */
function localFile(db: Db, bookId: string, place: Place): string | null {
  const files = db
    .select({ location: bookFiles.location, idx: bookFiles.idx })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .orderBy(asc(bookFiles.idx))
    .all();
  return (
    files.find((f) => f.location === place.fileLocation)?.location ??
    files.find((f) => f.idx === place.fileIndex)?.location ??
    null
  );
}

function bookSnapshot(db: Db, bookId: string): BookSnapshot | null {
  const book = db.select().from(books).where(eq(books.id, bookId)).get();
  if (book?.source !== 'addon') return null;
  return {
    title: book.title,
    author: book.author,
    kind: book.kind,
    coverUrl: book.coverUrl,
    addonItem: book.addonItem,
    durationMs: book.durationMs,
    parts: db
      .select({
        location: bookFiles.location,
        uri: bookFiles.uri,
        title: bookFiles.title,
        durationMs: bookFiles.durationMs,
        size: bookFiles.size,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.idx))
      .all(),
    // Chapters found from silences stay on the device that found them.
    chapters: db
      .select({ title: chapters.title, startMs: chapters.startMs })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.found, false)))
      .orderBy(asc(chapters.idx))
      .all(),
  };
}

function episodeSnapshot(db: Db, bookId: string): EpisodeSnapshot | null {
  const row = db
    .select({ episode: episodes, podcast: podcasts })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.bookId, bookId))
    .get();
  if (!row) return null;
  const { episode, podcast } = row;
  return {
    podcast: { title: podcast.title, author: podcast.author, coverUrl: podcast.coverUrl },
    title: episode.title,
    url: episode.url,
    mime: episode.mime,
    size: episode.size,
    durationMs: episode.durationMs,
    publishedAt: episode.publishedAt,
    season: episode.season,
    number: episode.number,
  };
}

/**
 * Every change made after `since`, as operations. A streamed book or an episode travels along
 * with the first operation that names it, so the other device can make it before using it.
 */
export function collectOps(db: Db, since: number): Op[] {
  const ops: Op[] = [];
  const described = new Set<string>();
  const keyOf = new Map<string, string | null>();
  const key = (bookId: string): string | null => {
    if (!keyOf.has(bookId)) {
      const k = bookKey(db, bookId);
      keyOf.set(bookId, k);
      if (k && !described.has(k)) {
        described.add(k);
        const book = bookSnapshot(db, bookId);
        const at =
          db.select({ at: books.updatedAt }).from(books).where(eq(books.id, bookId)).get()?.at ??
          since;
        if (book) ops.push({ type: 'book', key: k, at, data: book });
        const episode = parseEpisodeKey(k) ? episodeSnapshot(db, bookId) : null;
        if (episode) ops.push({ type: 'episode', key: k, at, data: episode });
      }
    }
    return keyOf.get(bookId) ?? null;
  };

  for (const p of db.select().from(profiles).where(gt(profiles.updatedAt, since)).all()) {
    ops.push({
      type: 'profile',
      key: p.id,
      at: p.updatedAt,
      data: {
        name: p.name,
        createdAt: p.createdAt,
        avatar: p.avatar,
        pinHash: p.pinHash,
        kids: p.kids,
        hiddenAddons: p.hiddenAddons,
      },
    });
  }
  for (const b of db
    .select()
    .from(books)
    .where(and(gt(books.updatedAt, since), eq(books.source, 'addon')))
    .all()) {
    key(b.id);
  }
  for (const p of db.select().from(progress).where(gt(progress.updatedAt, since)).all()) {
    const k = key(p.bookId);
    if (!k) continue;
    ops.push({
      type: 'progress',
      profile: p.profileId,
      key: k,
      at: p.updatedAt,
      data: {
        fileLocation: p.fileLocation,
        fileIndex: fileIndexOf(db, p.bookId, p.fileLocation),
        filePositionMs: p.filePositionMs,
        bookPositionMs: p.bookPositionMs,
      },
    });
  }
  for (const e of db
    .select()
    .from(libraryEntries)
    .where(gt(libraryEntries.updatedAt, since))
    .all()) {
    const k = key(e.bookId);
    if (!k) continue;
    ops.push({
      type: 'entry',
      profile: e.profileId,
      key: k,
      at: e.updatedAt,
      data: {
        speed: e.speed,
        lastPlayedAt: e.lastPlayedAt,
        finishedAt: e.finishedAt,
        voiceEq: e.voiceEq,
        skipSilence: e.skipSilence,
        evenLoudness: e.evenLoudness,
      },
    });
  }
  for (const m of db.select().from(bookmarks).where(gt(bookmarks.updatedAt, since)).all()) {
    const k = key(m.bookId);
    if (!k) continue;
    ops.push({
      type: 'bookmark',
      profile: m.profileId,
      key: m.id,
      at: m.updatedAt,
      data: {
        book: k,
        fileLocation: m.fileLocation,
        fileIndex: fileIndexOf(db, m.bookId, m.fileLocation),
        filePositionMs: m.filePositionMs,
        bookPositionMs: m.bookPositionMs,
        note: m.note,
        createdAt: m.createdAt,
      },
    });
  }
  const subs = db
    .select({ sub: subscriptions, podcast: podcasts })
    .from(subscriptions)
    .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
    .where(gt(subscriptions.updatedAt, since))
    .all();
  for (const { sub, podcast } of subs) {
    ops.push({
      type: 'subscription',
      profile: sub.profileId,
      key: podcast.feedUrl,
      at: sub.updatedAt,
      data: {
        title: podcast.title,
        coverUrl: podcast.coverUrl,
        autoDownload: sub.autoDownload,
        keepLatest: sub.keepLatest,
        skipIntroMs: sub.skipIntroMs,
        skipOutroMs: sub.skipOutroMs,
        subscribedAt: sub.subscribedAt,
        voiceEq: sub.voiceEq,
        skipSilence: sub.skipSilence,
        evenLoudness: sub.evenLoudness,
      },
    });
  }
  for (const u of db.select().from(upNext).where(gt(upNext.updatedAt, since)).all()) {
    const k = key(u.bookId);
    if (!k) continue;
    ops.push({
      type: 'upNext',
      profile: u.profileId,
      key: k,
      at: u.updatedAt,
      data: { position: u.position, addedAt: u.addedAt },
    });
  }
  const synced = db
    .select()
    .from(settings)
    .where(and(gt(settings.updatedAt, since), inArray(settings.key, SYNCED_SETTINGS)))
    .all();
  for (const s of synced) {
    ops.push({
      type: 'setting',
      profile: s.profileId,
      key: s.key,
      at: s.updatedAt,
      data: { value: s.value },
    });
  }
  const choices = db
    .select()
    .from(settings)
    .where(and(gt(settings.updatedAt, since), like(settings.key, `${SOURCE_PREFIX}%`)))
    .all();
  for (const s of choices) {
    const choice = sourceChoiceOf(s.value);
    if (!choice) continue;
    ops.push({
      type: 'source',
      profile: s.profileId,
      key: s.key.slice(SOURCE_PREFIX.length),
      at: s.updatedAt,
      data: choice,
    });
  }
  const orders = db
    .select()
    .from(settings)
    .where(and(gt(settings.updatedAt, since), like(settings.key, `${SERIES_ORDER_PREFIX}%`)))
    .all();
  for (const s of orders) {
    ops.push({
      type: 'seriesOrder',
      profile: s.profileId,
      key: s.key.slice(SERIES_ORDER_PREFIX.length),
      at: s.updatedAt,
      data: { books: cleanOrder(s.value) },
    });
  }
  const ratings = db
    .select()
    .from(settings)
    .where(and(gt(settings.updatedAt, since), like(settings.key, `${RATING_PREFIX}%`)))
    .all();
  for (const s of ratings) {
    const name = s.key.slice(RATING_PREFIX.length);
    // A streamed book travels along, so the other device can make it first.
    const bookId = bookIdForKey(db, name);
    if (bookId) key(bookId);
    ops.push({
      type: 'rating',
      profile: s.profileId,
      key: name,
      at: s.updatedAt,
      data: { rating: cleanRating(s.value) },
    });
  }
  for (const t of db.select().from(bookTags).where(gt(bookTags.updatedAt, since)).all()) {
    const k = key(t.bookId);
    if (!k) continue;
    ops.push({
      type: 'tags',
      profile: t.profileId,
      key: k,
      at: t.updatedAt,
      data: { tags: t.tags },
    });
  }
  for (const h of db.select().from(hiddenBooks).where(gt(hiddenBooks.updatedAt, since)).all()) {
    ops.push({
      type: 'hidden',
      profile: h.profileId,
      key: h.bookKey,
      at: h.updatedAt,
      data: { hidden: h.hidden, notMusic: h.notMusic },
    });
  }
  for (const c of db.select().from(ownChapters).where(gt(ownChapters.updatedAt, since)).all()) {
    // A streamed book travels along, so the other device can make it first.
    const bookId = bookIdForKey(db, c.bookKey);
    if (bookId) key(bookId);
    ops.push({
      type: 'chapters',
      profile: c.profileId,
      key: c.bookKey,
      at: c.updatedAt,
      data: { chapters: c.chapters },
    });
  }
  for (const p of db.select().from(playlists).where(gt(playlists.updatedAt, since)).all()) {
    // Items are already keys; naming them here sends along streamed books the other device lacks.
    for (const item of p.items) {
      const bookId = bookIdForKey(db, item);
      if (bookId) key(bookId);
    }
    ops.push({
      type: 'playlist',
      profile: p.profileId,
      key: p.id,
      at: p.updatedAt,
      data: {
        name: p.name,
        rule: p.rule,
        items: p.items,
        createdAt: p.createdAt,
        keepFinished: p.keepFinished,
      },
    });
  }
  for (const l of db.select().from(workLinks).where(gt(workLinks.updatedAt, since)).all()) {
    ops.push({
      type: 'link',
      key: `${l.bookKey}\n${l.workType}\n${l.workId}`,
      at: l.updatedAt,
      data: {
        book: l.bookKey,
        workType: l.workType,
        workId: l.workId,
        state: l.state,
        ids: l.ids,
        meta: l.meta,
      },
    });
  }
  for (const t of db.select().from(tombstones).where(gt(tombstones.updatedAt, since)).all()) {
    ops.push({ type: 'delete', kind: t.kind, profile: t.profileId, key: t.key, at: t.deletedAt });
  }
  return ops.filter((op) => !isTestLibraryKey(op.key));
}

/**
 * The test library (Settings → Developer) stays on the device that made it: its books, lists
 * and bookmarks have `bench` keys, its podcasts `.invalid` feeds.
 */
function isTestLibraryKey(key: string): boolean {
  if (key.startsWith(BIG_LIBRARY_PREFIX) || key.startsWith('bench-')) return true;
  return isPlaceholderFeed(parseEpisodeKey(key)?.feedUrl ?? key);
}

/** A place another device saved, for the “continue from there?” prompt. */
export type Handoff = { bookId: string; profileId: string; bookPositionMs: number; at: number };

const MAX_TRIM_MS = 10 * 60_000;

/** A show's intro and outro from another device, when it sent them (M45), kept to a sane range. */
function trimOf(data: { skipIntroMs?: number; skipOutroMs?: number }) {
  const clamp = (ms: number) => Math.min(MAX_TRIM_MS, Math.max(0, Math.round(ms)));
  return {
    ...(typeof data.skipIntroMs === 'number' ? { skipIntroMs: clamp(data.skipIntroMs) } : {}),
    ...(typeof data.skipOutroMs === 'number' ? { skipOutroMs: clamp(data.skipOutroMs) } : {}),
  };
}

// Books and episodes first, so later operations in the same batch can find them.
const ORDER: Record<Op['type'], number> = {
  profile: 0,
  book: 1,
  episode: 1,
  subscription: 2,
  progress: 3,
  entry: 3,
  bookmark: 3,
  upNext: 3,
  setting: 3,
  tags: 3,
  hidden: 3,
  chapters: 3,
  playlist: 3,
  link: 3,
  source: 3,
  seriesOrder: 3,
  rating: 3,
  delete: 4,
};

/** Whether this version knows how to apply an operation; newer devices may send other types. */
export const knownOp = (op: { type: string }): op is Op => Object.hasOwn(ORDER, op.type);

function ensureProfile(db: Db, id: string, now: number): boolean {
  if (db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).get()) return true;
  db.insert(profiles).values({ id, name: 'Listener', createdAt: now, updatedAt: 0 }).run();
  return true;
}

function ensurePodcast(
  db: Db,
  feedUrl: string,
  info: { title: string; author?: string | null; coverUrl: string | null },
  newId: IdGenerator,
): string {
  const found = db
    .select({ id: podcasts.id })
    .from(podcasts)
    .where(eq(podcasts.feedUrl, feedUrl))
    .get();
  if (found) return found.id;
  const id = newId();
  // Updated at 0: the next feed refresh fills in the rest.
  db.insert(podcasts)
    .values({
      id,
      feedUrl,
      title: info.title,
      author: info.author ?? null,
      coverUrl: webCover(info.coverUrl),
      updatedAt: 0,
    })
    .run();
  return id;
}

// A streamed book's parts are add-on stream addresses, which the protocol keeps to http(s). Any
// other address from another device would make this phone open a file or app of its own.
const webPart = (part: Part): boolean => /^https?:\/\//i.test(part.uri);

function applyBook(db: Db, op: Extract<Op, { type: 'book' }>, newId: IdGenerator): void {
  if (bookIdForKey(db, op.key)) return;
  const { data } = op;
  if (!data.parts.every(webPart)) return;
  const bookId = newId();
  db.insert(books)
    .values({
      id: bookId,
      rootId: null,
      location: op.key,
      kind: data.kind,
      source: 'addon',
      title: data.title,
      author: data.author,
      coverPath: null,
      coverUrl: webCover(data.coverUrl),
      addonItem: data.addonItem,
      durationMs: data.durationMs,
      addedAt: op.at,
      updatedAt: op.at,
    })
    .run();
  for (const [idx, part] of data.parts.entries()) {
    db.insert(bookFiles)
      .values({
        id: newId(),
        location: part.location,
        rootId: null,
        bookId,
        idx,
        uri: part.uri,
        relPath: part.uri,
        name: part.title ?? `Part ${idx + 1}`,
        title: part.title,
        size: part.size,
        modifiedAt: op.at,
        durationMs: part.durationMs,
        chaptersJson: [],
        updatedAt: op.at,
      })
      .onConflictDoNothing()
      .run();
  }
  for (const [idx, chapter] of data.chapters.entries()) {
    db.insert(chapters)
      .values({ id: newId(), bookId, idx, ...chapter, updatedAt: op.at })
      .run();
  }
}

function applyEpisode(
  db: Db,
  op: Extract<Op, { type: 'episode' }>,
  now: number,
  newId: IdGenerator,
): void {
  const ref = parseEpisodeKey(op.key);
  if (!ref || bookIdForKey(db, op.key)) return;
  const { data } = op;
  const podcastId = ensurePodcast(db, ref.feedUrl, data.podcast, newId);
  let episode = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.podcastId, podcastId), eq(episodes.guid, ref.guid)))
    .get();
  if (!episode) {
    episode = { id: newId() };
    db.insert(episodes)
      .values({
        id: episode.id,
        podcastId,
        guid: ref.guid,
        title: data.title,
        url: data.url,
        mime: data.mime,
        size: data.size,
        durationMs: data.durationMs,
        publishedAt: data.publishedAt,
        season: data.season,
        number: data.number,
        updatedAt: 0,
      })
      .run();
  }
  episodeBook(db, episode.id, now, newId);
}

/** Applies another device's operations; a row changes only when the operation is newer. */
export function applyOps(db: Db, ops: Op[], now: number, newId: IdGenerator): Handoff[] {
  const handoffs: Handoff[] = [];
  // A newer device may send types this version does not know; they sort last and are skipped.
  const sorted = [...ops].sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  db.transaction((tx) => {
    for (const op of sorted) {
      switch (op.type) {
        case 'profile': {
          const found = tx.select().from(profiles).where(eq(profiles.id, op.key)).get();
          const row = {
            name: op.data.name,
            // Older devices send only the name.
            ...(op.data.avatar !== undefined ? { avatar: op.data.avatar } : {}),
            ...(op.data.pinHash !== undefined ? { pinHash: op.data.pinHash } : {}),
            ...(op.data.kids !== undefined ? { kids: op.data.kids } : {}),
            ...(op.data.hiddenAddons !== undefined ? { hiddenAddons: op.data.hiddenAddons } : {}),
            updatedAt: op.at,
          };
          if (!found) {
            tx.insert(profiles)
              .values({ id: op.key, createdAt: op.data.createdAt, ...row })
              .run();
          } else if (op.at > found.updatedAt) {
            tx.update(profiles).set(row).where(eq(profiles.id, op.key)).run();
          }
          break;
        }
        case 'book':
          applyBook(tx, op, newId);
          break;
        case 'episode':
          applyEpisode(tx, op, now, newId);
          break;
        case 'progress': {
          const bookId = bookIdForKey(tx, op.key);
          const fileLocation = bookId ? localFile(tx, bookId, op.data) : null;
          if (!bookId || !fileLocation || !ensureProfile(tx, op.profile, now)) break;
          const where = and(eq(progress.profileId, op.profile), eq(progress.bookId, bookId));
          const local = tx
            .select({ updatedAt: progress.updatedAt })
            .from(progress)
            .where(where)
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = {
            fileLocation,
            filePositionMs: op.data.filePositionMs,
            bookPositionMs: op.data.bookPositionMs,
            updatedAt: op.at,
          };
          tx.insert(progress)
            .values({ profileId: op.profile, bookId, ...row })
            .onConflictDoUpdate({ target: [progress.profileId, progress.bookId], set: row })
            .run();
          handoffs.push({
            bookId,
            profileId: op.profile,
            bookPositionMs: op.data.bookPositionMs,
            at: op.at,
          });
          break;
        }
        case 'entry': {
          const bookId = bookIdForKey(tx, op.key);
          if (!bookId || !ensureProfile(tx, op.profile, now)) break;
          const where = and(
            eq(libraryEntries.profileId, op.profile),
            eq(libraryEntries.bookId, bookId),
          );
          const local = tx
            .select({ updatedAt: libraryEntries.updatedAt })
            .from(libraryEntries)
            .where(where)
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = {
            speed: op.data.speed,
            lastPlayedAt: op.data.lastPlayedAt,
            finishedAt: op.data.finishedAt,
            ...syncedOverrides(op.data),
            updatedAt: op.at,
          };
          tx.insert(libraryEntries)
            .values({ profileId: op.profile, bookId, ...row })
            .onConflictDoUpdate({
              target: [libraryEntries.profileId, libraryEntries.bookId],
              set: row,
            })
            .run();
          break;
        }
        case 'bookmark': {
          const bookId = bookIdForKey(tx, op.data.book);
          const fileLocation = bookId ? localFile(tx, bookId, op.data) : null;
          if (!bookId || !fileLocation || !ensureProfile(tx, op.profile, now)) break;
          const local = tx
            .select({ updatedAt: bookmarks.updatedAt })
            .from(bookmarks)
            .where(eq(bookmarks.id, op.key))
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = {
            fileLocation,
            filePositionMs: op.data.filePositionMs,
            bookPositionMs: op.data.bookPositionMs,
            note: op.data.note,
            updatedAt: op.at,
          };
          tx.insert(bookmarks)
            .values({
              id: op.key,
              profileId: op.profile,
              bookId,
              createdAt: op.data.createdAt,
              ...row,
            })
            .onConflictDoUpdate({ target: bookmarks.id, set: row })
            .run();
          break;
        }
        case 'subscription': {
          if (!ensureProfile(tx, op.profile, now)) break;
          const podcastId = ensurePodcast(tx, op.key, op.data, newId);
          const where = and(
            eq(subscriptions.profileId, op.profile),
            eq(subscriptions.podcastId, podcastId),
          );
          const local = tx
            .select({ updatedAt: subscriptions.updatedAt })
            .from(subscriptions)
            .where(where)
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = {
            autoDownload: op.data.autoDownload,
            keepLatest: op.data.keepLatest,
            ...trimOf(op.data),
            ...syncedOverrides(op.data),
            updatedAt: op.at,
          };
          tx.insert(subscriptions)
            .values({
              profileId: op.profile,
              podcastId,
              subscribedAt: op.data.subscribedAt,
              // Counted from its arrival here, or every episode so far would show as new.
              seenAt: now,
              newSince: now,
              ...row,
            })
            .onConflictDoUpdate({
              target: [subscriptions.profileId, subscriptions.podcastId],
              set: row,
            })
            .run();
          break;
        }
        case 'upNext': {
          const bookId = bookIdForKey(tx, op.key);
          if (!bookId || !ensureProfile(tx, op.profile, now)) break;
          const where = and(eq(upNext.profileId, op.profile), eq(upNext.bookId, bookId));
          const local = tx.select({ updatedAt: upNext.updatedAt }).from(upNext).where(where).get();
          if (local && local.updatedAt >= op.at) break;
          const row = { position: op.data.position, updatedAt: op.at };
          tx.insert(upNext)
            .values({ profileId: op.profile, bookId, addedAt: op.data.addedAt, ...row })
            .onConflictDoUpdate({ target: [upNext.profileId, upNext.bookId], set: row })
            .run();
          break;
        }
        case 'setting': {
          if (!SYNCED_SETTINGS.includes(op.key) || !ensureProfile(tx, op.profile, now)) break;
          const where = and(eq(settings.profileId, op.profile), eq(settings.key, op.key));
          const local = tx
            .select({ updatedAt: settings.updatedAt })
            .from(settings)
            .where(where)
            .get();
          if (local && local.updatedAt >= op.at) break;
          tx.insert(settings)
            .values({ profileId: op.profile, key: op.key, value: op.data.value, updatedAt: op.at })
            .onConflictDoUpdate({
              target: [settings.profileId, settings.key],
              set: { value: op.data.value, updatedAt: op.at },
            })
            .run();
          break;
        }
        case 'tags': {
          const bookId = bookIdForKey(tx, op.key);
          if (!bookId || !ensureProfile(tx, op.profile, now)) break;
          const where = and(eq(bookTags.profileId, op.profile), eq(bookTags.bookId, bookId));
          const local = tx
            .select({ updatedAt: bookTags.updatedAt })
            .from(bookTags)
            .where(where)
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = { tags: op.data.tags, updatedAt: op.at };
          tx.insert(bookTags)
            .values({ profileId: op.profile, bookId, ...row })
            .onConflictDoUpdate({ target: [bookTags.profileId, bookTags.bookId], set: row })
            .run();
          break;
        }
        case 'playlist': {
          if (!ensureProfile(tx, op.profile, now)) break;
          const local = tx
            .select({ updatedAt: playlists.updatedAt })
            .from(playlists)
            .where(eq(playlists.id, op.key))
            .get();
          if (local && local.updatedAt >= op.at) break;
          const row = {
            name: op.data.name,
            rule: op.data.rule,
            items: op.data.items,
            // A device from before M112 doesn't know the choice; it stays as it was.
            ...(op.data.keepFinished !== undefined ? { keepFinished: op.data.keepFinished } : {}),
            updatedAt: op.at,
          };
          tx.insert(playlists)
            .values({ id: op.key, profileId: op.profile, createdAt: op.data.createdAt, ...row })
            .onConflictDoUpdate({ target: playlists.id, set: row })
            .run();
          break;
        }
        case 'link':
          applyLink(tx, op);
          break;
        case 'hidden':
          applyHidden(tx, op, now);
          break;
        case 'chapters':
          applyOwnChapters(tx, op, now);
          break;
        case 'source':
          applySource(tx, op, now);
          break;
        case 'seriesOrder':
          applySeriesOrder(tx, op, now);
          break;
        case 'rating':
          applyRating(tx, op, now);
          break;
        case 'delete':
          applyDelete(tx, op);
          break;
      }
    }
  });
  return handoffs;
}

const isText = (value: unknown, max = 2048): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Another device's link, checked field by field: it is only data, and the newest one wins. */
function applyLink(db: Db, op: Extract<Op, { type: 'link' }>): void {
  if (typeof op.data !== 'object' || op.data === null) return;
  const { book, workType, workId, state, ids, meta } = op.data;
  if (!isText(book) || !isText(workType, 64) || !isText(workId, 512)) return;
  if (state !== 'linked' && state !== 'rejected') return;
  const cleanIds = Array.isArray(ids)
    ? normalizeIds(ids.filter((id): id is string => isText(id, 512)).slice(0, 50))
    : [];
  const cleanMeta: LinkedMeta | null =
    meta && typeof meta === 'object' && isText(meta.title, 1000)
      ? {
          title: meta.title,
          author: isText(meta.author, 1000) ? meta.author : null,
          cover: isText(meta.cover) && /^https?:\/\//.test(meta.cover) ? meta.cover : null,
          ...(isText(meta.series, 1000) ? { series: meta.series } : {}),
        }
      : null;
  const where = and(
    eq(workLinks.bookKey, book),
    eq(workLinks.workType, workType),
    eq(workLinks.workId, workId),
  );
  const local = db.select({ updatedAt: workLinks.updatedAt }).from(workLinks).where(where).get();
  if (local && local.updatedAt >= op.at) return;
  const row = { state, ids: cleanIds, meta: cleanMeta, updatedAt: op.at };
  db.insert(workLinks)
    .values({ bookKey: book, workType, workId, ...row })
    .onConflictDoUpdate({
      target: [workLinks.bookKey, workLinks.workType, workLinks.workId],
      set: row,
    })
    .run();
}

/** Another device's hidden mark; kept by the book's name even when the book isn't here yet. */
function applyHidden(db: Db, op: Extract<Op, { type: 'hidden' }>, now: number): void {
  if (typeof op.data !== 'object' || op.data === null) return;
  const { hidden, notMusic } = op.data;
  if (!isText(op.key) || !isText(op.profile, 256)) return;
  if (typeof hidden !== 'boolean' || typeof notMusic !== 'boolean') return;
  if (!ensureProfile(db, op.profile, now)) return;
  const where = and(eq(hiddenBooks.profileId, op.profile), eq(hiddenBooks.bookKey, op.key));
  const local = db
    .select({ updatedAt: hiddenBooks.updatedAt })
    .from(hiddenBooks)
    .where(where)
    .get();
  if (local && local.updatedAt >= op.at) return;
  const row = { hidden, notMusic, updatedAt: op.at };
  db.insert(hiddenBooks)
    .values({ profileId: op.profile, bookKey: op.key, ...row })
    .onConflictDoUpdate({ target: [hiddenBooks.profileId, hiddenBooks.bookKey], set: row })
    .run();
}

/**
 * Another device's chapters for a book, checked: it is only data. Kept by the book's name even
 * when the book isn't here yet; cleaned without a length, since this device may not know it.
 */
function applyOwnChapters(db: Db, op: Extract<Op, { type: 'chapters' }>, now: number): void {
  if (typeof op.data !== 'object' || op.data === null) return;
  if (!isText(op.key) || !isText(op.profile, 256)) return;
  if (typeof op.at !== 'number' || !Number.isFinite(op.at)) return;
  const list: unknown = op.data.chapters;
  if (list !== null && !Array.isArray(list)) return;
  if (!ensureProfile(db, op.profile, now)) return;
  const where = and(eq(ownChapters.profileId, op.profile), eq(ownChapters.bookKey, op.key));
  const local = db
    .select({ updatedAt: ownChapters.updatedAt })
    .from(ownChapters)
    .where(where)
    .get();
  if (local && local.updatedAt >= op.at) return;
  const clean =
    list === null
      ? null
      : cleanChapters(
          list.filter(
            (c): c is { title: unknown; startMs: unknown } => typeof c === 'object' && c !== null,
          ),
          0,
          (n) => String(n),
        );
  const row = { chapters: clean, updatedAt: op.at };
  db.insert(ownChapters)
    .values({ profileId: op.profile, bookKey: op.key, ...row })
    .onConflictDoUpdate({ target: [ownChapters.profileId, ownChapters.bookKey], set: row })
    .run();
}

/** Another device's source choice; kept by the work, so it waits for the book to be played. */
function applySource(db: Db, op: Extract<Op, { type: 'source' }>, now: number): void {
  const choice = sourceChoiceOf(op.data);
  if (!choice || !isText(op.key, 1024) || !op.key.includes(':') || !isText(op.profile, 256)) return;
  if (typeof op.at !== 'number' || !Number.isFinite(op.at)) return;
  if (!ensureProfile(db, op.profile, now)) return;
  const key = `${SOURCE_PREFIX}${op.key}`;
  const where = and(eq(settings.profileId, op.profile), eq(settings.key, key));
  const local = db.select({ updatedAt: settings.updatedAt }).from(settings).where(where).get();
  if (local && local.updatedAt >= op.at) return;
  const value = JSON.stringify(choice);
  db.insert(settings)
    .values({ profileId: op.profile, key, value, updatedAt: op.at })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: op.at },
    })
    .run();
}

/** Another device's order of a series; kept by the series' key and the books' synced names. */
function applySeriesOrder(db: Db, op: Extract<Op, { type: 'seriesOrder' }>, now: number): void {
  if (typeof op.data !== 'object' || op.data === null) return;
  if (!isText(op.key, 1024) || !isText(op.profile, 256)) return;
  if (typeof op.at !== 'number' || !Number.isFinite(op.at)) return;
  if (!ensureProfile(db, op.profile, now)) return;
  const key = `${SERIES_ORDER_PREFIX}${op.key}`;
  const where = and(eq(settings.profileId, op.profile), eq(settings.key, key));
  const local = db.select({ updatedAt: settings.updatedAt }).from(settings).where(where).get();
  if (local && local.updatedAt >= op.at) return;
  const value = JSON.stringify(cleanOrder(op.data.books));
  db.insert(settings)
    .values({ profileId: op.profile, key, value, updatedAt: op.at })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: op.at },
    })
    .run();
}

/** Another device's rating of a book; kept by the book's name even when the book isn't here. */
function applyRating(db: Db, op: Extract<Op, { type: 'rating' }>, now: number): void {
  if (typeof op.data !== 'object' || op.data === null) return;
  if (!isText(op.key) || !isText(op.profile, 256)) return;
  if (typeof op.at !== 'number' || !Number.isFinite(op.at)) return;
  const rating = op.data.rating === null ? null : cleanRating(op.data.rating);
  if (op.data.rating !== null && rating === null) return;
  if (!ensureProfile(db, op.profile, now)) return;
  const key = `${RATING_PREFIX}${op.key}`;
  const where = and(eq(settings.profileId, op.profile), eq(settings.key, key));
  const local = db.select({ updatedAt: settings.updatedAt }).from(settings).where(where).get();
  if (local && local.updatedAt >= op.at) return;
  const value = JSON.stringify(rating);
  db.insert(settings)
    .values({ profileId: op.profile, key, value, updatedAt: op.at })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: op.at },
    })
    .run();
}

/**
 * Versions before M45 kept a show's settings without its intro and outro but took the change's
 * time, so after updating the show read 0 until someone changed it again. Given every subscription
 * change the group holds, a row that still reads 0 and 0 takes the values of the newest change
 * that carries them (unless the subscription was removed after it). Rows changed here after
 * `pushedAt` are left alone: that change has not reached the group yet. The row keeps its time,
 * so nothing is sent back. Returns how many rows changed.
 */
export function fillMissingSkips(db: Db, ops: Op[], pushedAt: number): number {
  const newest = new Map<string, Extract<Op, { type: 'subscription' }>>();
  const removed = new Map<string, number>();
  const rowKey = (profile: string, feed: string) => `${profile}\u0000${feed}`;
  for (const op of ops) {
    if (op.type === 'delete' && op.kind === 'subscription') {
      const id = rowKey(op.profile, op.key);
      removed.set(id, Math.max(removed.get(id) ?? 0, op.at));
    }
    if (op.type !== 'subscription' || typeof op.data !== 'object' || op.data === null) continue;
    if (typeof op.data.skipIntroMs !== 'number' && typeof op.data.skipOutroMs !== 'number')
      continue;
    const id = rowKey(op.profile, op.key);
    const held = newest.get(id);
    if (!held || op.at > held.at) newest.set(id, op);
  }
  let changed = 0;
  db.transaction((tx) => {
    for (const [id, op] of newest) {
      if ((removed.get(id) ?? -Infinity) >= op.at) continue;
      const trim = trimOf(op.data);
      if (!trim.skipIntroMs && !trim.skipOutroMs) continue;
      const podcast = tx
        .select({ id: podcasts.id })
        .from(podcasts)
        .where(eq(podcasts.feedUrl, op.key))
        .get();
      if (!podcast) continue;
      const where = and(
        eq(subscriptions.profileId, op.profile),
        eq(subscriptions.podcastId, podcast.id),
        eq(subscriptions.skipIntroMs, 0),
        eq(subscriptions.skipOutroMs, 0),
        lte(subscriptions.updatedAt, pushedAt),
      );
      if (!tx.select({ at: subscriptions.updatedAt }).from(subscriptions).where(where).get()) {
        continue;
      }
      tx.update(subscriptions).set(trim).where(where).run();
      changed++;
    }
  });
  return changed;
}

function applyDelete(db: Db, op: Extract<Op, { type: 'delete' }>): void {
  const profile = op.profile === '' ? null : op.profile;
  switch (op.kind) {
    case 'bookmark': {
      const local = db
        .select({ updatedAt: bookmarks.updatedAt })
        .from(bookmarks)
        .where(eq(bookmarks.id, op.key))
        .get();
      if (local && local.updatedAt > op.at) return;
      db.delete(bookmarks).where(eq(bookmarks.id, op.key)).run();
      break;
    }
    case 'upNext': {
      const bookId = bookIdForKey(db, op.key);
      if (!bookId || !profile) return;
      const where = and(eq(upNext.profileId, profile), eq(upNext.bookId, bookId));
      const local = db.select({ updatedAt: upNext.updatedAt }).from(upNext).where(where).get();
      if (!local || local.updatedAt > op.at) return;
      db.delete(upNext).where(where).run();
      break;
    }
    case 'subscription': {
      const podcast = db
        .select({ id: podcasts.id })
        .from(podcasts)
        .where(eq(podcasts.feedUrl, op.key))
        .get();
      if (!podcast || !profile) return;
      const where = and(
        eq(subscriptions.profileId, profile),
        eq(subscriptions.podcastId, podcast.id),
      );
      const local = db
        .select({ updatedAt: subscriptions.updatedAt })
        .from(subscriptions)
        .where(where)
        .get();
      if (!local || local.updatedAt > op.at) return;
      db.delete(subscriptions).where(where).run();
      break;
    }
    case 'playlist': {
      const local = db
        .select({ updatedAt: playlists.updatedAt })
        .from(playlists)
        .where(eq(playlists.id, op.key))
        .get();
      if (!local || local.updatedAt > op.at) return;
      db.delete(playlists).where(eq(playlists.id, op.key)).run();
      break;
    }
    case 'profile': {
      const local = db
        .select({ updatedAt: profiles.updatedAt })
        .from(profiles)
        .where(eq(profiles.id, op.key))
        .get();
      if (!local || local.updatedAt > op.at) return;
      for (const table of [
        progress,
        libraryEntries,
        bookmarks,
        settings,
        subscriptions,
        upNext,
        bookTags,
        hiddenBooks,
        ownChapters,
        playlists,
        listeningLog,
        scrobbleOutbox,
      ]) {
        db.delete(table).where(eq(table.profileId, op.key)).run();
      }
      db.delete(tombstones).where(eq(tombstones.profileId, op.key)).run();
      db.delete(profiles).where(eq(profiles.id, op.key)).run();
      break;
    }
    case 'book': {
      const book = db
        .select({ id: books.id, source: books.source, updatedAt: books.updatedAt })
        .from(books)
        .where(eq(books.location, op.key))
        .get();
      if (book?.source !== 'addon' || book.updatedAt > op.at) return;
      db.delete(bookFiles).where(eq(bookFiles.bookId, book.id)).run();
      db.delete(books).where(eq(books.id, book.id)).run();
      break;
    }
  }
  // Kept here too, so this device does not send the deleted row back.
  recordDeletion(db, op.kind, op.key, profile, op.at);
}

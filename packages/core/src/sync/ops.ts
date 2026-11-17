import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { episodeBook } from '../podcasts/repository';
import {
  type AddonItemRef,
  bookFiles,
  bookmarks,
  books,
  bookTags,
  chapters,
  episodes,
  libraryEntries,
  playlists,
  podcasts,
  profiles,
  progress,
  settings,
  type SmartRule,
  subscriptions,
  tombstones,
  upNext,
} from '../schema';
import { bookIdForKey, bookKey, parseEpisodeKey, recordDeletion, type TombstoneKind } from './keys';

/** Settings that follow the listener between devices; download rules stay with each device. */
export const SYNCED_SETTINGS = ['duckOnInterruption', 'skipIntervalMs', 'smartRewind'];

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
      data: { speed: number; lastPlayedAt: number | null; finishedAt: number | null };
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
        subscribedAt: number;
      };
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
      data: { name: string; rule: SmartRule | null; items: string[]; createdAt: number };
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
    chapters: db
      .select({ title: chapters.title, startMs: chapters.startMs })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
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
      data: { speed: e.speed, lastPlayedAt: e.lastPlayedAt, finishedAt: e.finishedAt },
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
        subscribedAt: sub.subscribedAt,
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
      data: { name: p.name, rule: p.rule, items: p.items, createdAt: p.createdAt },
    });
  }
  for (const t of db.select().from(tombstones).where(gt(tombstones.updatedAt, since)).all()) {
    ops.push({ type: 'delete', kind: t.kind, profile: t.profileId, key: t.key, at: t.deletedAt });
  }
  return ops;
}

/** A place another device saved, for the “continue from there?” prompt. */
export type Handoff = { bookId: string; profileId: string; bookPositionMs: number; at: number };

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
  playlist: 3,
  delete: 4,
};

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
      coverUrl: info.coverUrl,
      updatedAt: 0,
    })
    .run();
  return id;
}

function applyBook(db: Db, op: Extract<Op, { type: 'book' }>, newId: IdGenerator): void {
  if (bookIdForKey(db, op.key)) return;
  const { data } = op;
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
      coverUrl: data.coverUrl,
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
          const row = { ...op.data, updatedAt: op.at };
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
            updatedAt: op.at,
          };
          tx.insert(subscriptions)
            .values({
              profileId: op.profile,
              podcastId,
              subscribedAt: op.data.subscribedAt,
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
            updatedAt: op.at,
          };
          tx.insert(playlists)
            .values({ id: op.key, profileId: op.profile, createdAt: op.data.createdAt, ...row })
            .onConflictDoUpdate({ target: playlists.id, set: row })
            .run();
          break;
        }
        case 'delete':
          applyDelete(tx, op);
          break;
      }
    }
  });
  return handoffs;
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
        playlists,
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

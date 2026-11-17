import { and, desc, eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { StoredChapter } from '../schema';
import type { IdGenerator } from '../ids';
import {
  bookFiles,
  books,
  chapters,
  downloads,
  episodes,
  libraryEntries,
  podcasts,
  progress,
  subscriptions,
} from '../schema';
import { recordDeletion } from '../sync/keys';
import type { EpisodeExtras, PodcastExtras } from './podcasting';
import type { ParsedFeed } from './rss';

export type FeedCache = { etag: string | null; lastModified: string | null };

const episodeLocation = (podcastId: string, guid: string) => `feed:${podcastId}:${guid}`;
const episodeFileLocation = (podcastId: string, guid: string) => `episode:${podcastId}:${guid}`;

/**
 * Stores a fetched feed: the podcast and every episode in it, keyed by guid. Returns the podcast
 * ID and the IDs of episodes it did not have before.
 */
export function saveFeed(
  db: Db,
  feedUrl: string,
  feed: ParsedFeed,
  cache: FeedCache,
  now: number,
  newId: IdGenerator,
): { podcastId: string; added: string[] } {
  return db.transaction((tx) => {
    const values = {
      guid: feed.guid,
      title: feed.title,
      author: feed.author,
      description: feed.description,
      coverUrl: feed.coverUrl,
      link: feed.link,
      extras: feed.extras,
      etag: cache.etag,
      lastModified: cache.lastModified,
      fetchedAt: now,
      updatedAt: now,
    };
    const existing = tx
      .select({ id: podcasts.id })
      .from(podcasts)
      .where(eq(podcasts.feedUrl, feedUrl))
      .get();
    const podcastId = existing?.id ?? newId();
    if (existing) tx.update(podcasts).set(values).where(eq(podcasts.id, podcastId)).run();
    else
      tx.insert(podcasts)
        .values({ id: podcastId, feedUrl, ...values })
        .run();

    const known = new Map(
      tx
        .select({ id: episodes.id, guid: episodes.guid, bookId: episodes.bookId })
        .from(episodes)
        .where(eq(episodes.podcastId, podcastId))
        .all()
        .map((e) => [e.guid, e]),
    );
    const added: string[] = [];
    for (const episode of feed.episodes) {
      const row = {
        title: episode.title,
        description: episode.description,
        publishedAt: episode.publishedAt,
        season: episode.season,
        number: episode.number,
        durationMs: episode.durationMs,
        url: episode.url,
        mime: episode.mime,
        size: episode.size,
        extras: episode.extras,
        updatedAt: now,
      };
      const found = known.get(episode.guid);
      if (found) {
        tx.update(episodes).set(row).where(eq(episodes.id, found.id)).run();
        // A moved enclosure: the episode's book streams from the new address.
        if (found.bookId) {
          tx.update(bookFiles)
            .set({ uri: episode.url, relPath: episode.url, updatedAt: now })
            .where(eq(bookFiles.location, episodeFileLocation(podcastId, episode.guid)))
            .run();
        }
      } else {
        const id = newId();
        tx.insert(episodes)
          .values({ id, podcastId, guid: episode.guid, ...row })
          .run();
        added.push(id);
      }
    }
    return { podcastId, added };
  });
}

export function feedCache(db: Db, feedUrl: string): FeedCache | null {
  const row = db
    .select({ etag: podcasts.etag, lastModified: podcasts.lastModified, extras: podcasts.extras })
    .from(podcasts)
    .where(eq(podcasts.feedUrl, feedUrl))
    .get();
  if (!row) return null;
  // Stored before Podcasting 2.0 fields were read: fetch the whole feed once to fill them in.
  if (row.extras === null) return { etag: null, lastModified: null };
  return { etag: row.etag, lastModified: row.lastModified };
}

export function subscribe(db: Db, profileId: string, podcastId: string, now: number): void {
  db.insert(subscriptions)
    .values({ profileId, podcastId, subscribedAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
}

/** Ends a subscription. The episodes' places stay, so subscribing again picks them up. */
export function unsubscribe(db: Db, profileId: string, podcastId: string, now = Date.now()): void {
  db.delete(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
    .run();
  const feed = db
    .select({ feedUrl: podcasts.feedUrl })
    .from(podcasts)
    .where(eq(podcasts.id, podcastId))
    .get();
  if (feed) recordDeletion(db, 'subscription', feed.feedUrl, profileId, now);
}

export function setAutoDownload(
  db: Db,
  profileId: string,
  podcastId: string,
  rule: { autoDownload: boolean; keepLatest: number },
  now: number,
): void {
  db.update(subscriptions)
    .set({
      autoDownload: rule.autoDownload,
      keepLatest: Math.max(1, rule.keepLatest),
      updatedAt: now,
    })
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
    .run();
}

export type Subscription = {
  podcastId: string;
  feedUrl: string;
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
  link: string | null;
  guid: string | null;
  autoDownload: boolean;
  keepLatest: number;
  subscribedAt: number;
  latestAt: number | null;
  unplayed: number;
};

export function listSubscriptions(db: Db, profileId: string): Subscription[] {
  const rows = db
    .select({ podcast: podcasts, sub: subscriptions })
    .from(subscriptions)
    .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
    .where(eq(subscriptions.profileId, profileId))
    .all();
  return rows
    .map(({ podcast, sub }) => {
      const list = listEpisodes(db, profileId, podcast.id);
      return {
        podcastId: podcast.id,
        feedUrl: podcast.feedUrl,
        title: podcast.title,
        author: podcast.author,
        description: podcast.description,
        coverUrl: podcast.coverUrl,
        link: podcast.link,
        guid: podcast.guid,
        autoDownload: sub.autoDownload,
        keepLatest: sub.keepLatest,
        subscribedAt: sub.subscribedAt,
        latestAt: list[0]?.publishedAt ?? null,
        unplayed: list.filter((e) => !e.finished).length,
      };
    })
    .sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
}

export function getSubscription(db: Db, profileId: string, podcastId: string): Subscription | null {
  return listSubscriptions(db, profileId).find((s) => s.podcastId === podcastId) ?? null;
}

export function findPodcast(db: Db, by: { feedUrl?: string; guid?: string }) {
  if (by.feedUrl) {
    const found = db.select().from(podcasts).where(eq(podcasts.feedUrl, by.feedUrl)).get();
    if (found) return found;
  }
  if (by.guid) return db.select().from(podcasts).where(eq(podcasts.guid, by.guid)).get() ?? null;
  return null;
}

export type EpisodeItem = {
  id: string;
  podcastId: string;
  title: string;
  description: string | null;
  publishedAt: number | null;
  season: number | null;
  number: number | null;
  durationMs: number;
  size: number;
  bookId: string | null;
  positionMs: number;
  finished: boolean;
  downloadState: 'queued' | 'done' | 'failed' | null;
  /** Podcasting 2.0 fields; null for episodes stored before they were read. */
  extras: EpisodeExtras | null;
};

/** Newest first, with each episode's place, played state and download. */
export function listEpisodes(db: Db, profileId: string, podcastId: string): EpisodeItem[] {
  return db
    .select({
      episode: episodes,
      positionMs: progress.bookPositionMs,
      finishedAt: libraryEntries.finishedAt,
      downloadState: downloads.state,
    })
    .from(episodes)
    .leftJoin(
      progress,
      and(eq(progress.bookId, episodes.bookId), eq(progress.profileId, profileId)),
    )
    .leftJoin(
      libraryEntries,
      and(eq(libraryEntries.bookId, episodes.bookId), eq(libraryEntries.profileId, profileId)),
    )
    .leftJoin(downloads, eq(downloads.bookId, episodes.bookId))
    .where(eq(episodes.podcastId, podcastId))
    .orderBy(desc(episodes.publishedAt))
    .all()
    .map(({ episode, positionMs, finishedAt, downloadState }) => ({
      id: episode.id,
      podcastId: episode.podcastId,
      title: episode.title,
      description: episode.description,
      publishedAt: episode.publishedAt,
      season: episode.season,
      number: episode.number,
      durationMs: episode.durationMs,
      size: episode.size,
      bookId: episode.bookId,
      positionMs: positionMs ?? 0,
      finished: finishedAt !== null && finishedAt !== undefined,
      downloadState: downloadState ?? null,
      extras: episode.extras,
    }));
}

/**
 * The library book that plays an episode, made on first use. Episodes then share everything
 * books have: the saved place, the journal, bookmarks, downloads and Up Next.
 */
export function episodeBook(db: Db, episodeId: string, now: number, newId: IdGenerator): string {
  return db.transaction((tx) => {
    const row = tx
      .select({ episode: episodes, podcast: podcasts })
      .from(episodes)
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(episodes.id, episodeId))
      .get();
    if (!row) throw new Error('This episode is no longer in its feed.');
    const { episode, podcast } = row;
    if (episode.bookId) return episode.bookId;
    const bookId = newId();
    tx.insert(books)
      .values({
        id: bookId,
        rootId: null,
        location: episodeLocation(podcast.id, episode.guid),
        kind: 'file',
        source: 'feed',
        title: episode.title,
        author: podcast.title,
        coverPath: null,
        coverUrl: podcast.coverUrl,
        durationMs: episode.durationMs,
        addedAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(bookFiles)
      .values({
        id: newId(),
        location: episodeFileLocation(podcast.id, episode.guid),
        rootId: null,
        bookId,
        idx: 0,
        uri: episode.url,
        relPath: episode.url,
        name: episode.title,
        title: episode.title,
        size: episode.size,
        modifiedAt: now,
        durationMs: episode.durationMs,
        chaptersJson: [],
        updatedAt: now,
      })
      .run();
    tx.update(episodes).set({ bookId, updatedAt: now }).where(eq(episodes.id, episodeId)).run();
    return bookId;
  });
}

/** The podcast an episode book belongs to. */
export function episodeOfBook(db: Db, bookId: string) {
  return db.select().from(episodes).where(eq(episodes.bookId, bookId)).get() ?? null;
}

/**
 * Auto-download: for each podcast where it is on, the newest `keepLatest` unplayed episodes that
 * are not downloaded yet, and the downloads of played episodes to remove.
 */
export function autoDownloadWork(
  db: Db,
  profileId: string,
): { download: string[]; remove: string[] } {
  const download: string[] = [];
  const remove: string[] = [];
  const auto = db
    .select({ podcastId: subscriptions.podcastId, keepLatest: subscriptions.keepLatest })
    .from(subscriptions)
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.autoDownload, true)))
    .all();
  for (const { podcastId, keepLatest } of auto) {
    const list = listEpisodes(db, profileId, podcastId);
    const wanted = list.filter((e) => !e.finished).slice(0, keepLatest);
    for (const e of wanted) if (e.downloadState === null) download.push(e.id);
    for (const e of list)
      if (e.finished && e.downloadState !== null && e.bookId) remove.push(e.bookId);
  }
  return { download, remove };
}

export type EpisodeDetail = {
  episodeId: string;
  podcastId: string;
  podcastTitle: string;
  title: string;
  extras: EpisodeExtras | null;
  podcastExtras: PodcastExtras | null;
};

/** The Podcasting 2.0 fields of the episode a book plays, or null for any other book. */
export function episodeDetail(db: Db, bookId: string): EpisodeDetail | null {
  const row = db
    .select({ episode: episodes, podcast: podcasts })
    .from(episodes)
    .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
    .where(eq(episodes.bookId, bookId))
    .get();
  if (!row) return null;
  return {
    episodeId: row.episode.id,
    podcastId: row.podcast.id,
    podcastTitle: row.podcast.title,
    title: row.episode.title,
    extras: row.episode.extras,
    podcastExtras: row.podcast.extras,
  };
}

/**
 * Chapters from an episode's chapters file. Only an episode book without chapters takes them, so
 * chapters embedded in the audio always win. Returns whether they were stored.
 */
export function saveEpisodeChapters(
  db: Db,
  bookId: string,
  list: StoredChapter[],
  now: number,
  newId: IdGenerator,
): boolean {
  if (list.length === 0) return false;
  return db.transaction((tx) => {
    const files = tx
      .select({ id: bookFiles.id, chaptersJson: bookFiles.chaptersJson })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .all();
    const episode = tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.bookId, bookId))
      .get();
    const file = files[0];
    if (!episode || !file || files.length !== 1 || file.chaptersJson.length > 0) return false;
    const existing = tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .get();
    if (existing) return false;
    tx.update(bookFiles)
      .set({ chaptersJson: list, updatedAt: now })
      .where(eq(bookFiles.id, file.id))
      .run();
    list.forEach((c, idx) =>
      tx
        .insert(chapters)
        .values({ id: newId(), bookId, idx, title: c.title, startMs: c.startMs, updatedAt: now })
        .run(),
    );
    return true;
  });
}

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

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
import { isPlaceholderFeed } from './placeholder';
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
  // Stored before Podcasting 2.0 fields (M23) or M75's soundbites and value were read: fetch the
  // whole feed once to fill them in.
  if (row.extras === null || row.extras.value === undefined) {
    return { etag: null, lastModified: null };
  }
  return { etag: row.etag, lastModified: row.lastModified };
}

export function subscribe(db: Db, profileId: string, podcastId: string, now: number): void {
  db.insert(subscriptions)
    .values({ profileId, podcastId, subscribedAt: now, seenAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
}

/**
 * Notes that this profile looked at the podcast now, so its episodes so far are no longer new.
 * Returns when it looked before, or null if it never did.
 */
export function markPodcastSeen(
  db: Db,
  profileId: string,
  podcastId: string,
  now: number,
): number | null {
  const where = and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId));
  const before = db.select({ seenAt: subscriptions.seenAt }).from(subscriptions).where(where).get();
  if (!before) return null;
  db.update(subscriptions).set({ seenAt: now }).where(where).run();
  return before.seenAt;
}

/**
 * Starts the clock for subscriptions that have none, such as those from before M105 or another
 * device's: their episodes so far are not new, only those that arrive from now on.
 */
export function startSeenClocks(db: Db, now: number): void {
  db.update(subscriptions).set({ seenAt: now }).where(isNull(subscriptions.seenAt)).run();
}

/** An episode counts as new while it is unstarted and came out after the listener last looked. */
export function isNewEpisode(
  episode: { publishedAt: number | null; finished: boolean; positionMs: number },
  seenAt: number | null,
): boolean {
  return (
    seenAt !== null &&
    episode.publishedAt !== null &&
    episode.publishedAt > seenAt &&
    !episode.finished &&
    episode.positionMs === 0
  );
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

/**
 * Seconds to skip at the start and the end of every episode of a show (M45), per profile. Like
 * auto-download, it syncs with the subscription.
 */
export function setTrim(
  db: Db,
  profileId: string,
  podcastId: string,
  trim: { skipIntroMs: number; skipOutroMs: number },
  now: number,
): void {
  db.update(subscriptions)
    .set({
      skipIntroMs: Math.max(0, Math.round(trim.skipIntroMs)),
      skipOutroMs: Math.max(0, Math.round(trim.skipOutroMs)),
      updatedAt: now,
    })
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
    .run();
}

/** The intro and outro to skip for an episode's book, from its show's subscription. */
export function trimOfBook(
  db: Db,
  profileId: string,
  bookId: string,
): { skipIntroMs: number; skipOutroMs: number } {
  const row = db
    .select({ skipIntroMs: subscriptions.skipIntroMs, skipOutroMs: subscriptions.skipOutroMs })
    .from(episodes)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.podcastId, episodes.podcastId), eq(subscriptions.profileId, profileId)),
    )
    .where(eq(episodes.bookId, bookId))
    .get();
  return row ?? { skipIntroMs: 0, skipOutroMs: 0 };
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
  skipIntroMs: number;
  skipOutroMs: number;
  subscribedAt: number;
  /** When this profile last opened the podcast's page here; null before it started counting. */
  seenAt: number | null;
  latestAt: number | null;
  unplayed: number;
  /** Unstarted episodes published since `seenAt`, for the cover's “new” badge (M105). */
  newEpisodes: number;
};

/** Newest episode first. Counted in one query: 500 podcasts are 20,000 episodes or more. */
export function listSubscriptions(db: Db, profileId: string, podcastId?: string): Subscription[] {
  return db
    .select({
      podcastId: podcasts.id,
      feedUrl: podcasts.feedUrl,
      title: podcasts.title,
      author: podcasts.author,
      description: podcasts.description,
      coverUrl: podcasts.coverUrl,
      link: podcasts.link,
      guid: podcasts.guid,
      autoDownload: subscriptions.autoDownload,
      keepLatest: subscriptions.keepLatest,
      skipIntroMs: subscriptions.skipIntroMs,
      skipOutroMs: subscriptions.skipOutroMs,
      subscribedAt: subscriptions.subscribedAt,
      seenAt: subscriptions.seenAt,
      latestAt: sql<number | null>`max(${episodes.publishedAt})`,
      // count() of a column skips nulls: every episode, less those this profile finished.
      unplayed: sql<number>`count(${episodes.id}) - count(${libraryEntries.finishedAt})`.mapWith(
        Number,
      ),
      // The same rule as `isNewEpisode`; a null `seen_at` makes the comparison null, so none.
      newEpisodes: sql<number>`count(case when ${episodes.publishedAt} > ${subscriptions.seenAt}
        and ${libraryEntries.finishedAt} is null and coalesce(${progress.bookPositionMs}, 0) = 0
        then 1 end)`.mapWith(Number),
    })
    .from(subscriptions)
    .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
    .leftJoin(episodes, eq(episodes.podcastId, podcasts.id))
    .leftJoin(
      libraryEntries,
      and(eq(libraryEntries.bookId, episodes.bookId), eq(libraryEntries.profileId, profileId)),
    )
    .leftJoin(
      progress,
      and(eq(progress.bookId, episodes.bookId), eq(progress.profileId, profileId)),
    )
    .where(
      and(
        eq(subscriptions.profileId, profileId),
        podcastId === undefined ? undefined : eq(subscriptions.podcastId, podcastId),
      ),
    )
    .groupBy(subscriptions.podcastId)
    .all()
    .sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
}

/** The newest episode of each subscription that this profile has not finished. */
export function newestUnfinishedEpisodes(
  db: Db,
  profileId: string,
): { id: string; bookId: string | null; publishedAt: number | null }[] {
  const newest = new Map<
    string,
    { id: string; bookId: string | null; publishedAt: number | null }
  >();
  const rows = db
    .select({
      id: episodes.id,
      podcastId: episodes.podcastId,
      bookId: episodes.bookId,
      publishedAt: episodes.publishedAt,
    })
    .from(episodes)
    .innerJoin(
      subscriptions,
      and(eq(subscriptions.podcastId, episodes.podcastId), eq(subscriptions.profileId, profileId)),
    )
    .leftJoin(
      libraryEntries,
      and(eq(libraryEntries.bookId, episodes.bookId), eq(libraryEntries.profileId, profileId)),
    )
    .where(isNull(libraryEntries.finishedAt))
    .orderBy(episodes.podcastId, desc(episodes.publishedAt))
    .all();
  for (const { podcastId, ...episode } of rows) {
    if (!newest.has(podcastId)) newest.set(podcastId, episode);
  }
  return [...newest.values()];
}

export function getSubscription(db: Db, profileId: string, podcastId: string): Subscription | null {
  return listSubscriptions(db, profileId, podcastId)[0] ?? null;
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
    .select({
      podcastId: subscriptions.podcastId,
      keepLatest: subscriptions.keepLatest,
      feedUrl: podcasts.feedUrl,
    })
    .from(subscriptions)
    .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.autoDownload, true)))
    .all();
  for (const { podcastId, keepLatest, feedUrl } of auto) {
    if (isPlaceholderFeed(feedUrl)) continue;
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
    // Chapters found from silences give way to the feed's.
    const existing = tx
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), eq(chapters.found, false)))
      .get();
    if (existing) return false;
    tx.delete(chapters).where(eq(chapters.bookId, bookId)).run();
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

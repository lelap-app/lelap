import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { presentFiles } from '../library/bookFiles';
import { setFinished } from '../library/queries';
import { parseOpml } from '../podcasts/opml';
import { episodeBook, findPodcast, subscribe } from '../podcasts/repository';
import { saveProgress } from '../progress';
import { episodes, libraryEntries, progress } from '../schema';
import { ImportError, type ImportSummary } from './summary';

// AntennaPod's "Database export" is its SQLite file: Feeds → FeedItems → FeedMedia. Its OPML
// export has the subscriptions only. Positions and dates there are in milliseconds.

export type AntennaPodEpisode = {
  /** The feed's guid; AntennaPod leaves it empty when the feed has none. */
  guid: string | null;
  /** The enclosure address, which Lelap uses as the guid when there is none. */
  url: string | null;
  title: string;
  played: boolean;
  positionMs: number;
  lastPlayedAt: number | null;
  completedAt: number | null;
};

export type AntennaPodFeed = { title: string; feedUrl: string; episodes: AntennaPodEpisode[] };

export type AntennaPodData = {
  feeds: AntennaPodFeed[];
  /** Titles of AntennaPod's local-folder feeds, which have no address to subscribe to. */
  localFeeds: string[];
};

/** Runs a query on the exported database; the app opens it with expo-sqlite or sql.js. */
export type SqlAll = (sql: string) => Promise<Record<string, unknown>[]>;

const SQLITE_MAGIC = 'SQLite format 3\0';

/** Whether a file is an SQLite database rather than text such as OPML. */
export function isSqlite(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, SQLITE_MAGIC.length)) === SQLITE_MAGIC;
}

const num = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0) || 0);
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const time = (value: unknown) => (num(value) > 0 ? num(value) : null);

async function columns(all: SqlAll, table: string): Promise<Set<string>> {
  return new Set((await all(`PRAGMA table_info(${table})`)).map((c) => str(c.name)));
}

/** Subscriptions and the played or started episodes from AntennaPod's database export. */
export async function readAntennaPod(all: SqlAll): Promise<AntennaPodData> {
  const feedColumns = await columns(all, 'Feeds');
  const mediaColumns = await columns(all, 'FeedMedia');
  if (!feedColumns.has('download_url') || !mediaColumns.has('feeditem')) {
    throw new ImportError('This is not an AntennaPod database export.');
  }
  // Older exports lack these columns; every feed in them is a subscription.
  const state = feedColumns.has('state') ? 'state' : '0';
  const lastPlayed = mediaColumns.has('last_played_time') ? 'm.last_played_time' : 'NULL';
  const completed = mediaColumns.has('playback_completion_date')
    ? 'm.playback_completion_date'
    : 'NULL';

  const data: AntennaPodData = { feeds: [], localFeeds: [] };
  const byId = new Map<number, AntennaPodFeed>();
  for (const f of await all(`SELECT id, title, download_url, ${state} AS state FROM Feeds`)) {
    const feedUrl = str(f.download_url);
    const title = str(f.title) || feedUrl;
    if (num(f.state) !== 0) continue;
    if (!/^https?:\/\//i.test(feedUrl)) {
      data.localFeeds.push(title);
      continue;
    }
    const feed: AntennaPodFeed = { title, feedUrl, episodes: [] };
    byId.set(num(f.id), feed);
    data.feeds.push(feed);
  }

  const rows = await all(
    `SELECT i.feed AS feed, i.item_identifier AS guid, i.title AS title, i.read AS read,
       m.download_url AS url, m.position AS position, ${lastPlayed} AS last_played,
       ${completed} AS completed
     FROM FeedItems i LEFT JOIN FeedMedia m ON m.feeditem = i.id
     WHERE i.read = 1 OR m.position > 0`,
  );
  for (const row of rows) {
    const feed = byId.get(num(row.feed));
    if (!feed) continue;
    feed.episodes.push({
      guid: str(row.guid) || null,
      url: str(row.url) || null,
      title: str(row.title),
      played: num(row.read) === 1,
      positionMs: Math.max(0, num(row.position)),
      lastPlayedAt: time(row.last_played),
      completedAt: time(row.completed),
    });
  }
  return data;
}

/** Subscriptions only, from AntennaPod's OPML export. */
export function antennaPodFromOpml(xml: string): AntennaPodData {
  return {
    feeds: parseOpml(xml).map((f) => ({ title: f.title, feedUrl: f.feedUrl, episodes: [] })),
    localFeeds: [],
  };
}

function findEpisode(db: Db, podcastId: string, item: AntennaPodEpisode) {
  for (const guid of [item.guid, item.url]) {
    if (!guid) continue;
    const found = db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.podcastId, podcastId), eq(episodes.guid, guid)))
      .get();
    if (found) return found.id;
  }
  if (!item.url) return null;
  return (
    db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.podcastId, podcastId), eq(episodes.url, item.url)))
      .get()?.id ?? null
  );
}

function applyEpisode(
  db: Db,
  profileId: string,
  episodeId: string,
  item: AntennaPodEpisode,
  now: number,
  newId: IdGenerator,
): boolean {
  const bookId = episodeBook(db, episodeId, now, newId);
  const key = (table: typeof progress | typeof libraryEntries) =>
    and(eq(table.profileId, profileId), eq(table.bookId, bookId));
  if (item.played) {
    const entry = db
      .select({ finishedAt: libraryEntries.finishedAt })
      .from(libraryEntries)
      .where(key(libraryEntries))
      .get();
    if (entry?.finishedAt) return false;
    setFinished(db, profileId, bookId, true, now, item.completedAt ?? item.lastPlayedAt ?? now);
    return true;
  }
  const stored = db
    .select({ updatedAt: progress.updatedAt })
    .from(progress)
    .where(key(progress))
    .get();
  // A place Lelap saved after AntennaPod's last play is newer; keep it.
  if (stored && stored.updatedAt >= (item.lastPlayedAt ?? 0)) return false;
  const file = presentFiles(db, bookId)[0];
  if (!file) return false;
  // Saved as now, so sync sends it on; the check above already kept newer places.
  return saveProgress(
    db,
    profileId,
    { bookId, fileLocation: file.location, filePositionMs: item.positionMs, savedAt: now },
    'app',
  );
}

/**
 * Subscribes to the feeds and carries over played marks and places. The app fetches each feed
 * first (subscribing needs its episodes); a feed that is not stored here is reported.
 */
export function applyAntennaPod(
  db: Db,
  profileId: string,
  data: AntennaPodData,
  now: number,
  newId: IdGenerator,
): ImportSummary {
  const summary: ImportSummary = { matched: 0, skipped: [] };
  for (const title of data.localFeeds) {
    summary.skipped.push({ item: title, reason: 'A local folder in AntennaPod' });
  }
  for (const feed of data.feeds) {
    const podcast = findPodcast(db, { feedUrl: feed.feedUrl });
    if (!podcast) {
      summary.skipped.push({ item: feed.title, reason: 'The feed could not be loaded' });
      continue;
    }
    subscribe(db, profileId, podcast.id, now);
    summary.matched++;
    let gone = 0;
    for (const item of feed.episodes) {
      const episodeId = findEpisode(db, podcast.id, item);
      if (!episodeId) gone++;
      else if (applyEpisode(db, profileId, episodeId, item, now, newId)) summary.matched++;
    }
    if (gone > 0) {
      summary.skipped.push({
        item: feed.title,
        reason: `${gone} episode${gone === 1 ? ' is' : 's are'} no longer in the feed`,
      });
    }
  }
  return summary;
}

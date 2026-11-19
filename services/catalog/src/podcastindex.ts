import type { Episode, Meta, MetaPreview } from '@lelap/sdk';
import { z } from 'zod';

import { htmlToText, httpUrl, truncate, unique } from './text';
import { TTL, type Upstream } from './upstream';

export const PODCAST_INDEX = 'https://api.podcastindex.org/api/1.0';
export const PREFIX = 'podcast:';
export const EPISODE_PREFIX = 'episode:';
const PAGE_SIZE = 30;
// Trending feeds carry no podcast GUID, so each one costs a lookup; keep the page small.
const TRENDING_SIZE = 20;
const MAX_EPISODES = 100;

export type PodcastIndexCredentials = { key: string; secret: string };

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const Feed = z.object({
  id: z.number().int(),
  podcastGuid: lenient(z.string().min(1)),
  title: lenient(z.string()),
  author: lenient(z.string()),
  ownerName: lenient(z.string()),
  description: lenient(z.string()),
  image: lenient(z.string()),
  artwork: lenient(z.string()),
  language: lenient(z.string()),
  link: lenient(z.string()),
  url: lenient(z.string()),
  categories: lenient(z.record(z.string(), z.string()).nullable()),
});
export type Feed = z.infer<typeof Feed>;

const EpisodeItem = z.object({
  guid: z.string().min(1).max(400),
  title: lenient(z.string()),
  description: lenient(z.string()),
  datePublished: lenient(z.number()),
  duration: lenient(z.number().nullable()),
});

const FeedList = z.object({ feeds: z.array(z.unknown()) });
const FeedOne = z.object({ feed: z.unknown() });
const EpisodeList = z.object({ items: z.array(z.unknown()) });

/** `Authorization` is the hex SHA-1 of key, secret and the unix time in seconds. */
export async function authHeaders(
  credentials: PodcastIndexCredentials,
  nowMs: number,
): Promise<Record<string, string>> {
  const date = String(Math.floor(nowMs / 1000));
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(credentials.key + credentials.secret + date),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { 'X-Auth-Key': credentials.key, 'X-Auth-Date': date, Authorization: hash };
}

function parseFeed(raw: unknown): Feed | null {
  const result = Feed.safeParse(raw);
  return result.success ? result.data : null;
}

function parseFeeds(data: unknown): Feed[] {
  const parsed = FeedList.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.feeds.flatMap((raw) => parseFeed(raw) ?? []);
}

function feedPreview(feed: Feed, guid: string): MetaPreview | null {
  const name = feed.title?.trim();
  if (!name) return null;
  const preview: MetaPreview = { id: `${PREFIX}${guid}`, type: 'podcast', name };
  const author = feed.author?.trim() || feed.ownerName?.trim();
  if (author) preview.author = author;
  const cover = httpUrl(feed.artwork) ?? httpUrl(feed.image);
  if (cover) preview.cover = cover;
  const description = htmlToText(feed.description ?? '');
  if (description) preview.description = truncate(description, 500);
  return preview;
}

/** Filters `podcasts/trending` and `recent/feeds` take: language codes and category names. */
export type FeedFilter = { lang?: string; cat?: string; max: number; ttl: number };

export type PodcastIndex = {
  trending: () => Promise<MetaPreview[]>;
  search: (query: string) => Promise<MetaPreview[]>;
  meta: (id: string) => Promise<Meta | null>;
  /** Feeds from a listing endpoint, not looked up yet. */
  feeds: (path: 'podcasts/trending' | 'recent/feeds', filter: FeedFilter) => Promise<Feed[]>;
  /** Feeds from `search/byterm`, which has no language filter. */
  searchFeeds: (query: string, max: number) => Promise<Feed[]>;
  /** Previews, looking up the GUID (and what the listing left out) of feeds that lack one. */
  previews: (feeds: Feed[]) => Promise<MetaPreview[]>;
};

export function createPodcastIndex(
  upstream: Upstream,
  credentials: PodcastIndexCredentials,
): PodcastIndex {
  const get = async (path: string, params: Record<string, string>, ttl: number) =>
    upstream.json(`${PODCAST_INDEX}/${path}?${new URLSearchParams(params)}`, {
      ttl,
      headers: await authHeaders(credentials, upstream.now()),
    });

  // `recent/feeds` lists no author, artwork or description: those come from the lookup.
  const complete = async (feed: Feed): Promise<Feed> => {
    if (feed.podcastGuid) return feed;
    const data = await get('podcasts/byfeedid', { id: String(feed.id) }, TTL.item);
    const parsed = FeedOne.safeParse(data);
    const found = parsed.success ? parseFeed(parsed.data.feed) : null;
    if (!found) return feed;
    const listed = Object.fromEntries(Object.entries(feed).filter(([, v]) => v !== undefined));
    return { ...found, ...listed, podcastGuid: found.podcastGuid };
  };

  const previews = async (feeds: Feed[]): Promise<MetaPreview[]> => {
    const results = await Promise.allSettled(
      feeds.map(async (listed) => {
        const feed = await complete(listed);
        return feed.podcastGuid ? feedPreview(feed, feed.podcastGuid) : null;
      }),
    );
    return results.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    );
  };

  return {
    previews,
    async feeds(path, { lang, cat, max, ttl }) {
      const params: Record<string, string> = { max: String(max) };
      if (lang) params.lang = lang;
      if (cat) params.cat = cat;
      return parseFeeds(await get(path, params, ttl));
    },
    async searchFeeds(query, max) {
      return parseFeeds(await get('search/byterm', { q: query, max: String(max) }, TTL.catalog));
    },
    async trending() {
      const data = await get('podcasts/trending', { max: String(TRENDING_SIZE) }, TTL.catalog);
      return previews(parseFeeds(data));
    },
    async search(query) {
      const data = await get('search/byterm', { q: query, max: String(PAGE_SIZE) }, TTL.catalog);
      return previews(parseFeeds(data));
    },
    async meta(id) {
      if (!id.startsWith(PREFIX)) return null;
      const guid = id.slice(PREFIX.length);
      const [feedData, episodeData] = await Promise.all([
        get('podcasts/byguid', { guid }, TTL.item),
        get('episodes/bypodcastguid', { guid, max: String(MAX_EPISODES) }, TTL.item),
      ]);
      const parsed = FeedOne.safeParse(feedData);
      // An unknown GUID comes back as `feed: []`.
      const feed = parsed.success ? parseFeed(parsed.data.feed) : null;
      const preview = feed ? feedPreview(feed, guid) : null;
      if (!feed || !preview) return null;

      const meta: Meta = { ...preview };
      const description = htmlToText(feed.description ?? '');
      if (description) meta.description = truncate(description, 4000);
      if (feed.language) meta.language = feed.language;
      const genres = Object.values(feed.categories ?? {});
      if (genres.length > 0) meta.genres = unique(genres);
      const link = httpUrl(feed.link);
      if (link) meta.link = link;
      const feedUrl = httpUrl(feed.url);
      if (feedUrl) meta.feed = feedUrl;

      const items = EpisodeList.safeParse(episodeData);
      meta.episodes = (items.success ? items.data.items : []).flatMap((raw): Episode[] => {
        const result = EpisodeItem.safeParse(raw);
        if (!result.success) return [];
        const item = result.data;
        const episode: Episode = {
          id: `${EPISODE_PREFIX}${item.guid}`,
          title: item.title?.trim() ?? '',
        };
        if (item.datePublished)
          episode.released = new Date(item.datePublished * 1000).toISOString();
        if (item.duration && item.duration > 0)
          episode.durationMs = Math.round(item.duration * 1000);
        const text = htmlToText(item.description ?? '');
        if (text) episode.description = truncate(text, 2000);
        return [episode];
      });
      return meta;
    },
  };
}

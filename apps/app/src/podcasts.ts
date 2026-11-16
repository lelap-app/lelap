import {
  autoDownloadWork,
  buildOpml,
  carryFolderPlace,
  episodeBook,
  FeedError,
  feedCache,
  findPodcast,
  listSubscriptions,
  parseFeed,
  parseOpml,
  saveFeed,
  subscribe,
} from '@lelap/core';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { proxyBase } from './config';

import { db, newId } from './db';
import { deleteDownload, startDownload } from './downloads';
import { playBook, useLibrary } from './player';
import { profileId } from './profile';

const FETCH_TIMEOUT_MS = 20_000;
// Feeds are read from the phone, so refreshing often costs the listener's data, not ours.
const REFRESH_EVERY_MS = 30 * 60_000;

// The proxy is rate limited per address; the web app spaces its feed requests out.
const PROXY_SPACING_MS = 150;
let nextProxySlot = 0;

async function proxySlot(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextProxySlot - now);
  nextProxySlot = Math.max(now, nextProxySlot) + PROXY_SPACING_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Where to fetch a feed, and with which headers. Browsers can't read most feeds across origins,
 * so the web app goes through the proxy, with the validators in the URL: headers such as
 * `If-None-Match` would make the browser send a preflight request for every feed.
 */
function feedRequest(feedUrl: string, etag: string | null, lastModified: string | null) {
  if (Platform.OS !== 'web') {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
    return { url: feedUrl, headers };
  }
  const query = new URLSearchParams({ url: feedUrl });
  if (etag) query.set('etag', etag);
  if (lastModified) query.set('since', lastModified);
  return { url: `${proxyBase}/feed?${query.toString()}`, headers: {} };
}

/** Fetches and stores a feed. An unchanged feed (304) keeps what is stored. */
export async function fetchFeed(feedUrl: string): Promise<string> {
  const cache = feedCache(db, feedUrl);
  const { url, headers } = feedRequest(feedUrl, cache?.etag ?? null, cache?.lastModified ?? null);
  if (Platform.OS === 'web') await proxySlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const existing = findPodcast(db, { feedUrl });
    if (response.status === 304 && existing) return existing.id;
    if (!response.ok) throw new FeedError(`The feed answered HTTP ${response.status}.`);
    const feed = parseFeed(await response.text());
    return saveFeed(
      db,
      feedUrl,
      feed,
      { etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') },
      Date.now(),
      newId,
    ).podcastId;
  } finally {
    clearTimeout(timer);
  }
}

export async function subscribeToFeed(feedUrl: string): Promise<string> {
  const podcastId = await fetchFeed(feedUrl.trim());
  subscribe(db, profileId, podcastId, Date.now());
  return podcastId;
}

/** Starts downloads that auto-download asks for and removes played ones. */
export async function runAutoDownload(): Promise<void> {
  const work = autoDownloadWork(db, profileId);
  for (const episodeId of work.download) {
    await startDownload(episodeBook(db, episodeId, Date.now(), newId), null).catch(() => {});
  }
  for (const bookId of work.remove) await deleteDownload(bookId).catch(() => {});
}

let lastRefresh = 0;

/** Refreshes every subscribed feed; one failing feed never stops the others. */
export async function refreshPodcasts(force = false): Promise<void> {
  if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  lastRefresh = Date.now();
  const subs = listSubscriptions(db, profileId);
  await Promise.all(subs.map((s) => fetchFeed(s.feedUrl).catch(() => null)));
  await runAutoDownload();
}

/** Refreshes feeds on start and when the app comes back, at most every half hour. */
export function PodcastSync() {
  const { refresh } = useLibrary();
  useEffect(() => {
    void refreshPodcasts().finally(refresh);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refreshPodcasts().finally(refresh);
    });
    return () => subscription.remove();
  }, [refresh]);
  return null;
}

export async function playEpisode(episodeId: string): Promise<void> {
  await playBook(episodeBook(db, episodeId, Date.now(), newId));
}

/** Subscribes to every feed in an OPML file. Returns how many were added and which failed. */
export async function importOpml(xml: string): Promise<{ added: number; failed: string[] }> {
  const feeds = parseOpml(xml);
  const failed: string[] = [];
  let added = 0;
  for (const feed of feeds) {
    try {
      await subscribeToFeed(feed.feedUrl);
      added++;
    } catch {
      failed.push(feed.title);
    }
  }
  return { added, failed };
}

export function exportOpml(): string {
  return buildOpml(
    listSubscriptions(db, profileId).map((s) => ({ title: s.title, feedUrl: s.feedUrl })),
    Date.now(),
  );
}

/** Turns a podcast folder in the local library into a subscription, keeping the place. */
export async function convertFolder(localBookId: string, feedUrl: string) {
  const podcastId = await subscribeToFeed(feedUrl);
  const result = carryFolderPlace(db, profileId, localBookId, podcastId, Date.now(), newId);
  return { podcastId, ...result };
}

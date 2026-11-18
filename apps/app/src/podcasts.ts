import {
  autoDownloadWork,
  buildOpml,
  carryFolderPlace,
  episodeBook,
  FeedError,
  feedRefreshEvents,
  isPlaceholderFeed,
  refreshFeeds,
  feedCache,
  findPlaceEpisode,
  findPodcast,
  listSubscriptions,
  parseFeed,
  parseOpml,
  saveFeed,
  subscribe,
  type FeedSoundbite,
  type SharedPlace,
} from '@lelap/core';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { proxyBase } from './config';

import { db, newId } from './db';
import { logDiagnostic } from './diagnostics';
import { deleteDownload, startDownload } from './downloads';
import { playClip } from './clips';
import { loadEpisodeChapters, loadEpisodeChaptersWithin } from './podcasting';
import { playAt, playBook, useLibrary, usePlayerState } from './player';
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
  // The test library's feeds: no request, not even to the proxy.
  if (isPlaceholderFeed(feedUrl)) throw new FeedError('This feed is made up for testing.');
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
    await startDownload(episodeBook(db, episodeId, Date.now(), newId), null, false).catch(() => {});
  }
  for (const bookId of work.remove) await deleteDownload(bookId).catch(() => {});
}

let lastRefresh = 0;

/**
 * Refreshes every subscribed feed; one failing feed never stops the others. `background` marks a
 * run Android started without the UI, for the diagnostics log.
 */
export async function refreshPodcasts(force = false, background = false): Promise<void> {
  if (!force && Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  lastRefresh = Date.now();
  const result = await refreshFeeds(db, profileId, fetchFeed);
  for (const event of feedRefreshEvents(result, background)) logDiagnostic(event);
  await runAutoDownload();
}

// How long playing an episode waits for its chapters file, so the player starts with chapters.
const CHAPTERS_WAIT_MS = 2_500;

/**
 * Refreshes feeds on start and when the app comes back, at most every half hour. Also gives an
 * episode that starts playing (from anywhere) the chapters of its feed's chapters file.
 */
export function PodcastSync() {
  const { refresh } = useLibrary();
  const { bookId } = usePlayerState();
  useEffect(() => {
    if (!bookId) return;
    void loadEpisodeChapters(bookId).then((added) => {
      if (added) refresh();
    });
  }, [bookId, refresh]);
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
  const bookId = episodeBook(db, episodeId, Date.now(), newId);
  await loadEpisodeChaptersWithin(bookId, CHAPTERS_WAIT_MS);
  await playBook(bookId);
}

/** Plays a soundbite as a clip: from its start, pausing at its end (M88). */
export async function playSoundbite(episodeId: string, soundbite: FeedSoundbite): Promise<void> {
  const bookId = episodeBook(db, episodeId, Date.now(), newId);
  await loadEpisodeChaptersWithin(bookId, CHAPTERS_WAIT_MS);
  await playClip(bookId, soundbite.startMs, soundbite.startMs + soundbite.durationMs);
}

/**
 * Plays a shared place in an episode (M88), following its show first when it is not on this
 * device. Returns false when the show's feed no longer lists the episode.
 */
export async function playSharedEpisode(place: SharedPlace): Promise<boolean> {
  if (!place.episode) return false;
  let found = findPlaceEpisode(db, profileId, place.episode);
  if (found?.kind === 'unknown') {
    await subscribeToFeed(place.episode.feed);
    found = findPlaceEpisode(db, profileId, place.episode);
  }
  if (found?.kind !== 'here') return false;
  const bookId = found.bookId ?? episodeBook(db, found.episodeId, Date.now(), newId);
  await loadEpisodeChaptersWithin(bookId, CHAPTERS_WAIT_MS);
  if (place.toMs !== null) await playClip(bookId, place.atMs, place.toMs);
  else await playAt(bookId, place.atMs);
  return true;
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

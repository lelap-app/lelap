import { t } from './i18n';
import {
  chapterImageAt,
  episodeDetail,
  getBook,
  parseChapterImages,
  parseChaptersFile,
  parseTranscript,
  partTranscripts,
  pickTranscript,
  saveEpisodeChapters,
  type ChapterImage,
  type FeedSoundbite,
  type FeedTranscript,
  type TranscriptCue,
} from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Platform } from 'react-native';

import { proxyBase } from './config';
import { db, newId } from './db';
import { profileId } from './profile';

const FETCH_TIMEOUT_MS = 20_000;

/**
 * A chapters file or transcript. Browsers can't read most of them across origins, so the web app
 * goes through the proxy, which passes text only; the phone fetches them itself.
 */
export async function fetchText(url: string): Promise<string> {
  const target =
    Platform.OS === 'web' ? `${proxyBase}/text?${new URLSearchParams({ url }).toString()}` : url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok)
      throw new Error(t('The file answered HTTP {status}.', { status: response.status }));
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

const chapterFiles = new Map<string, Promise<string>>();

/** A chapters file, fetched once per app start for both its chapters and its pictures. */
function fetchChaptersFile(url: string): Promise<string> {
  let file = chapterFiles.get(url);
  if (!file) {
    file = fetchText(url);
    // A failed fetch is tried again the next time it is asked for.
    file.catch(() => chapterFiles.delete(url));
    chapterFiles.set(url, file);
  }
  return file;
}

const attempts = new Map<string, Promise<boolean>>();

async function fetchChapters(bookId: string): Promise<boolean> {
  const url = episodeDetail(db, bookId)?.extras?.chaptersUrl;
  if (!url || (getBook(db, profileId, bookId)?.chapters.length ?? 0) > 0) return false;
  try {
    const chapters = parseChaptersFile(await fetchChaptersFile(url));
    return saveEpisodeChapters(db, bookId, chapters, Date.now(), newId);
  } catch {
    // No chapters is fine: the episode plays as one stretch, as before.
    return false;
  }
}

/**
 * Gives an episode book the chapters from its feed's chapters file, when the audio has none.
 * Tried once per book and app start; every caller gets whether chapters were added.
 */
export function loadEpisodeChapters(bookId: string): Promise<boolean> {
  let attempt = attempts.get(bookId);
  if (!attempt) {
    attempt = fetchChapters(bookId);
    attempts.set(bookId, attempt);
  }
  return attempt;
}

/** Waits at most `ms` for the chapters, so playback never waits long for them. */
export function loadEpisodeChaptersWithin(bookId: string, ms: number): Promise<boolean> {
  return Promise.race([
    loadEpisodeChapters(bookId),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * The pictures of an episode's chapters file (M88), for the player to show as each stretch plays.
 * Empty for any other book, a file without pictures, or one that can't be read.
 */
export async function loadChapterImages(bookId: string): Promise<ChapterImage[]> {
  const url = episodeDetail(db, bookId)?.extras?.chaptersUrl;
  if (!url) return [];
  const images = parseChapterImages(await fetchChaptersFile(url).catch(() => ''));
  readImages.set(url, images);
  return images;
}

const readImages = new Map<string, ChapterImage[]>();

/**
 * The chapter pictures already read this app start, for the lock screen and the car (M103):
 * the player's load is built at once, so pictures still on their way follow with an update.
 */
export function chapterImagesRead(bookId: string): ChapterImage[] {
  const url = episodeDetail(db, bookId)?.extras?.chaptersUrl;
  return url ? (readImages.get(url) ?? []) : [];
}

/** The chapters file's picture at a position of the playing book, or null for its own cover. */
export function useChapterImage(
  bookId: string | null,
  positionMs: number,
  // `version` is the signal to re-read the database: a refresh may bring a chapters file.
  version: number,
): string | null {
  const chaptersUrl = useMemo(
    () => (bookId ? (episodeDetail(db, bookId)?.extras?.chaptersUrl ?? null) : null),
    [bookId, version],
  );
  const images = useQuery({
    queryKey: ['chapter-images', chaptersUrl],
    queryFn: () => loadChapterImages(bookId ?? ''),
    enabled: chaptersUrl !== null,
    staleTime: Infinity,
  });
  return images.data ? chapterImageAt(images.data, positionMs) : null;
}

/** An episode book's soundbites; none for any other book. */
export function soundbitesOf(bookId: string): FeedSoundbite[] {
  return episodeDetail(db, bookId)?.extras?.soundbites ?? [];
}

/**
 * The transcript to show for a book: an episode's from its feed, or the playing part's from its
 * add-on's stream (M136, such as an Open lectures lecture).
 */
export function transcriptOf(bookId: string, fileLocation: string | null) {
  const extras = episodeDetail(db, bookId)?.extras;
  if (extras) return pickTranscript(extras.transcripts);
  return fileLocation ? pickTranscript(partTranscripts(db, bookId, fileLocation)) : null;
}

export async function loadTranscript(transcript: FeedTranscript): Promise<TranscriptCue[]> {
  return parseTranscript(await fetchText(transcript.url), transcript.type);
}

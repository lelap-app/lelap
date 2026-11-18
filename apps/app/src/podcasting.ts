import { t } from './i18n';
import {
  episodeDetail,
  getBook,
  parseChaptersFile,
  parseTranscript,
  pickTranscript,
  saveEpisodeChapters,
  type TranscriptCue,
} from '@lelap/core';
import { Platform } from 'react-native';

import { proxyBase } from './config';
import { db, newId } from './db';
import { chapterName } from './format';
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

const attempts = new Map<string, Promise<boolean>>();

async function fetchChapters(bookId: string): Promise<boolean> {
  const url = episodeDetail(db, bookId)?.extras?.chaptersUrl;
  if (!url || (getBook(db, profileId, bookId)?.chapters.length ?? 0) > 0) return false;
  try {
    const chapters = parseChaptersFile(await fetchText(url), chapterName);
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

/** The transcript to show for a book, if it is an episode whose feed lists one. */
export function transcriptOf(bookId: string) {
  const extras = episodeDetail(db, bookId)?.extras;
  return extras ? pickTranscript(extras.transcripts) : null;
}

export async function loadTranscript(bookId: string): Promise<TranscriptCue[]> {
  const transcript = transcriptOf(bookId);
  if (!transcript) return [];
  return parseTranscript(await fetchText(transcript.url), transcript.type);
}

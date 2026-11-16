import type { BookLoad, JournalEntry, PlayerSettings, PlayerState } from '@lelap/audio';

import * as opfs from './opfs';

export type { BookLoad, JournalEntry, PlayerSettings, PlayerState };

// The web player: one <audio> element playing the book's files in order, with the same API as
// the Android module. Media Session gives the lock screen, keyboard and headset controls. The
// journal lives in localStorage, written like the Android service writes its own.

type Subscription = { remove: () => void };

const JOURNAL_KEY = 'lelap.journal';
const JOURNAL_EVERY_MS = 10_000;
const TICK_MS = 1_000;
const FADE_MS = 60_000;

let element: HTMLAudioElement | null = null;
let book: BookLoad | null = null;
let index = -1;
let ended = false;
let buffering = false;
let error: string | null = null;
let pausedAt: number | null = null;
let settings: PlayerSettings = {
  duckOnInterruption: true,
  skipIntervalMs: 30_000,
  smartRewind: true,
};
let sleepRemainingMs: number | null = null;
let lastTick = 0;
let lastJournal = 0;
// When playback or a seek last moved the place; loading does not count (see writeJournal).
let placeChangedAt = 0;
let seekingForLoad = false;
let objectUrl: string | null = null;
const listeners = new Set<(state: PlayerState) => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

/** How far to rewind on Play after a pause; the same rule as the Android service. */
export function rewindOnResume(pausedForMs: number): number {
  if (pausedForMs < 60_000) return 0;
  return pausedForMs <= 3_600_000 ? 5_000 : 15_000;
}

const positionMs = () => (element ? Math.round(element.currentTime * 1000) : 0);
const playing = () => !!element && !element.paused && !element.ended;

function offsetOf(i: number): number {
  return (book?.files ?? []).slice(0, i).reduce((sum, f) => sum + f.durationMs, 0);
}

function chapterTitle(): string | null {
  if (!book) return null;
  const at = offsetOf(index) + positionMs();
  let title: string | null = null;
  for (const chapter of book.chapters) if (chapter.startMs <= at) title = chapter.title;
  return title ?? book.files[index]?.title ?? null;
}

function state(): PlayerState {
  const file = book?.files[index];
  const duration = element && Number.isFinite(element.duration) ? element.duration * 1000 : 0;
  return {
    connected: true,
    playing: playing(),
    buffering,
    ended,
    bookId: book?.bookId ?? null,
    fileLocation: file?.location ?? null,
    bookTitle: book?.title ?? null,
    partTitle: chapterTitle(),
    partIndex: book ? index : -1,
    partCount: book?.files.length ?? 0,
    positionMs: positionMs(),
    durationMs: duration || file?.durationMs || 0,
    speed: element?.playbackRate ?? 1,
    duckOnInterruption: settings.duckOnInterruption,
    waitingForCall: false,
    sleepTimerRemainingMs: sleepRemainingMs,
    error,
  };
}

function writeJournal(): void {
  const file = book?.files[index];
  // Before the media loads (or after it failed) the element reports 0, which would replace the
  // real place at the next start.
  if (!book || !file || !element || element.readyState === 0 || element.error) return;
  const entry: JournalEntry = {
    bookId: book.bookId,
    fileLocation: file.location,
    filePositionMs: positionMs(),
    // The time the place moved, not the write time: a stale place loaded here must not outrank
    // a newer one synced from another device.
    savedAt: placeChangedAt,
  };
  lastJournal = Date.now();
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the app's own saves still keep the place.
  }
}

function emit(): void {
  const now = state();
  for (const listener of listeners) listener(now);
  updateMediaSession(now);
}

function tick(): void {
  const now = Date.now();
  const elapsed = now - lastTick;
  lastTick = now;
  if (playing() && sleepRemainingMs !== null) {
    sleepRemainingMs = Math.max(0, sleepRemainingMs - elapsed);
    if (element) element.volume = Math.min(1, sleepRemainingMs / FADE_MS);
    if (sleepRemainingMs === 0) {
      sleepRemainingMs = null;
      element?.pause();
      if (element) element.volume = 1;
    }
  }
  if (playing() && now - lastJournal >= JOURNAL_EVERY_MS) {
    placeChangedAt = now;
    writeJournal();
  }
  emit();
}

function startTicker(): void {
  lastTick = Date.now();
  ticker ??= setInterval(tick, TICK_MS);
}

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function player(): HTMLAudioElement {
  if (element) return element;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.preservesPitch = true;
  audio.addEventListener('play', () => {
    ended = false;
    seekingForLoad = false;
    startTicker();
    emit();
  });
  audio.addEventListener('pause', () => {
    pausedAt = Date.now();
    placeChangedAt = pausedAt;
    writeJournal();
    stopTicker();
    emit();
  });
  audio.addEventListener('waiting', () => {
    buffering = true;
    emit();
  });
  audio.addEventListener('playing', () => {
    buffering = false;
    emit();
  });
  audio.addEventListener('seeked', () => {
    if (seekingForLoad) seekingForLoad = false;
    else {
      placeChangedAt = Date.now();
      writeJournal();
    }
    emit();
  });
  audio.addEventListener('error', () => {
    error = audio.error ? `Media error ${audio.error.code}: ${audio.error.message}` : 'Cannot play';
    emit();
  });
  audio.addEventListener('ended', () => {
    if (book && index < book.files.length - 1) {
      void setPart(index + 1, 0, true);
    } else {
      ended = true;
      placeChangedAt = Date.now();
      writeJournal();
      stopTicker();
      emit();
    }
  });
  window.addEventListener('pagehide', writeJournal);
  setUpMediaSession();
  element = audio;
  return audio;
}

/** A downloaded file is read from OPFS; anything else plays from its URL. */
async function sourceFor(uri: string): Promise<string> {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  if (!uri.startsWith('file://')) return uri;
  objectUrl = URL.createObjectURL(await opfs.readFile(uri.slice('file://'.length)));
  return objectUrl;
}

async function setPart(i: number, startMs: number, autoplay: boolean): Promise<void> {
  const file = book?.files[i];
  if (!file) return;
  const audio = player();
  index = i;
  ended = false;
  error = null;
  audio.src = await sourceFor(file.uri);
  audio.playbackRate = book?.speed ?? 1;
  await new Promise<void>((resolve) => {
    const ready = () => {
      audio.removeEventListener('loadedmetadata', ready);
      resolve();
    };
    audio.addEventListener('loadedmetadata', ready);
    audio.addEventListener('error', ready, { once: true });
    audio.load();
  });
  seekingForLoad = true;
  audio.currentTime = startMs / 1000;
  if (autoplay) await audio.play().catch(() => {});
  emit();
}

export async function load(next: BookLoad, autoplay: boolean): Promise<void> {
  book = next;
  pausedAt = next.pausedAt;
  placeChangedAt = next.pausedAt ?? 0;
  let start = next.startPositionMs;
  if (autoplay && settings.smartRewind && pausedAt !== null) {
    start = Math.max(0, start - rewindOnResume(Date.now() - pausedAt));
  }
  await setPart(next.startIndex, start, autoplay);
}

export async function seekTo(i: number, ms: number): Promise<void> {
  if (!book) return;
  if (i === index && element) element.currentTime = Math.max(0, ms) / 1000;
  else await setPart(i, Math.max(0, ms), playing());
}

export async function takeJournal(): Promise<JournalEntry | null> {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    return raw ? (JSON.parse(raw) as JournalEntry) : null;
  } catch {
    return null;
  }
}

export async function play(): Promise<void> {
  if (!element || !book) return;
  if (ended) await setPart(0, 0, false);
  if (settings.smartRewind && pausedAt !== null) {
    element.currentTime = Math.max(
      0,
      element.currentTime - rewindOnResume(Date.now() - pausedAt) / 1000,
    );
  }
  pausedAt = null;
  await element.play().catch((e: unknown) => {
    error = e instanceof Error ? e.message : String(e);
    emit();
  });
}

export async function pause(): Promise<void> {
  element?.pause();
}

/** Moves along the whole book, across files. */
export async function seekBy(deltaMs: number): Promise<void> {
  if (!book) return;
  const total = offsetOf(book.files.length);
  const target = Math.max(0, Math.min(total - 1, offsetOf(index) + positionMs() + deltaMs));
  let i = 0;
  while (i < book.files.length - 1 && offsetOf(i + 1) <= target) i++;
  await seekTo(i, target - offsetOf(i));
}

export async function skipToPart(i: number): Promise<void> {
  await seekTo(i, 0);
}

export async function setSpeed(speed: number): Promise<void> {
  if (book) book = { ...book, speed };
  if (element) element.playbackRate = speed;
  emit();
}

export async function setSettings(next: PlayerSettings): Promise<void> {
  settings = next;
  emit();
}

export async function skip(forward: boolean): Promise<void> {
  await seekBy(forward ? settings.skipIntervalMs : -settings.skipIntervalMs);
}

export async function startSleepTimer(minutes: number): Promise<void> {
  sleepRemainingMs = minutes * 60_000;
  emit();
}

export async function cancelSleepTimer(): Promise<void> {
  sleepRemainingMs = null;
  if (element) element.volume = 1;
  emit();
}

export async function unload(): Promise<void> {
  writeJournal();
  element?.pause();
  if (element) element.removeAttribute('src');
  book = null;
  index = -1;
  ended = false;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  emit();
}

export async function getState(): Promise<PlayerState> {
  return state();
}

export function addStateListener(listener: (state: PlayerState) => void): Subscription {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}

function setUpMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  session.setActionHandler('play', () => void play());
  session.setActionHandler('pause', () => void pause());
  // ⏮ and ⏭ skip by the interval, as on Android's lock screen.
  session.setActionHandler('previoustrack', () => void skip(false));
  session.setActionHandler('nexttrack', () => void skip(true));
  session.setActionHandler('seekbackward', () => void skip(false));
  session.setActionHandler('seekforward', () => void skip(true));
}

let shownMeta = '';

function updateMediaSession(now: PlayerState): void {
  if (!('mediaSession' in navigator) || !book) return;
  const key = `${book.bookId} ${now.partTitle ?? ''}`;
  if (key !== shownMeta) {
    shownMeta = key;
    const cover = book.coverUri && !book.coverUri.startsWith('file://') ? book.coverUri : null;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: now.partTitle ?? book.title,
      artist: book.author ?? '',
      album: book.title,
      artwork: cover ? [{ src: cover }] : [],
    });
  }
  navigator.mediaSession.playbackState = now.playing ? 'playing' : 'paused';
}

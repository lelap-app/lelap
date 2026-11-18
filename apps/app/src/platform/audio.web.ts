import type {
  Bedtime,
  BookLoad,
  CarLibrary,
  FinishedItem,
  JournalEntry,
  PlayerDiagnostic,
  PlayerSettings,
  PlayerState,
  ServiceAccounting,
  SleepTimerMode,
} from '@lelap/audio';
import {
  fadeVolume,
  mediaSpan,
  outroStartMs,
  PLAY_REFUSED,
  shouldRefreshLink,
  sleepBoundaryMs,
  sleepFileTarget,
  sleepRemainingMs as remainingToBoundary,
  trimmedStart,
} from '@lelap/core';

import * as opfs from './opfs';
import * as sound from './webaudio';

export type {
  Bedtime,
  BookLoad,
  CarLibrary,
  FinishedItem,
  JournalEntry,
  PlayerDiagnostic,
  PlayerSettings,
  PlayerState,
  ServiceAccounting,
  SleepTimerMode,
};

// The web player: one <audio> element playing the book's files in order, with the same API as
// the Android module. Media Session gives the lock screen, keyboard and headset controls. The
// journal lives in localStorage, written like the Android service writes its own.

type Subscription = { remove: () => void };

const JOURNAL_KEY = 'lelap.journal';
const JOURNAL_EVERY_MS = 10_000;
const TICK_MS = 1_000;

let element: HTMLAudioElement | null = null;
let book: BookLoad | null = null;
let queue: BookLoad[] = [];
let finished: FinishedItem[] = [];
let index = -1;
let ended = false;
let buffering = false;
let error: string | null = null;
let pausedAt: number | null = null;
let settings: PlayerSettings = {
  duckOnInterruption: true,
  skipIntervalMs: 30_000,
  smartRewind: true,
  mono: false,
  voiceEq: false,
  volumeBoost: false,
};
// A minutes timer counts wall time while playing; a chapter or episode timer stops at a place on
// the book timeline (shake to extend is Android only: browsers ask before giving motion data).
let sleepMode: SleepTimerMode | null = null;
let sleepRemainingMs: number | null = null;
let sleepBoundary: number | null = null;
let boundaryStop: ReturnType<typeof setTimeout> | null = null;
// One more request per expiry: set when the stream was asked again, cleared once it plays.
let linkRefreshed = false;
let lastPositionMs = 0;
let lastPlaying = false;
let lastTick = 0;
let lastJournal = 0;
// When playback or a seek last moved the place; loading does not count (see writeJournal).
let placeChangedAt = 0;
let seekingForLoad = false;
let objectUrl: string | null = null;
const listeners = new Set<(state: PlayerState) => void>();
// The diagnostics log's player events (M47), kept like the Android service keeps its own.
const DIAGNOSTICS_LIMIT = 200;
let diagnosticsOn = false;
let diagnostics: PlayerDiagnostic[] = [];
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

const durations = () => (book?.files ?? []).map((f) => f.durationMs);

function untilBoundary(): number | null {
  if (sleepBoundary === null) return null;
  return remainingToBoundary(
    sleepBoundary,
    offsetOf(index) + positionMs(),
    element?.playbackRate ?? 1,
  );
}

/** Finds the end of the chapter (or episode) playing now; seeks call it again. */
function placeBoundary(): void {
  clearBoundaryStop();
  if (!book || (sleepMode !== 'chapter' && sleepMode !== 'episode')) return;
  sleepBoundary = sleepBoundaryMs(
    sleepMode,
    offsetOf(index) + positionMs(),
    book.chapters.map((c) => c.startMs),
    durations(),
  );
}

function note(what: string, code: number | null = null): void {
  if (!diagnosticsOn) return;
  diagnostics.push({
    at: Date.now(),
    what,
    code,
    status: null,
    bookId: book?.bookId ?? null,
    part: index >= 0 ? index : null,
  });
  if (diagnostics.length > DIAGNOSTICS_LIMIT) diagnostics = diagnostics.slice(-DIAGNOSTICS_LIMIT);
}

function clearBoundaryStop(): void {
  if (boundaryStop) clearTimeout(boundaryStop);
  boundaryStop = null;
}

function clearSleepTimer(): void {
  clearBoundaryStop();
  sleepMode = null;
  sleepRemainingMs = null;
  sleepBoundary = null;
  if (element) element.volume = 1;
}

/** Stops inside a file exactly at the boundary, and parks the place on it. */
function stopAtBoundary(): void {
  const audio = element;
  if (!audio || sleepBoundary === null) return;
  const target = sleepFileTarget(sleepBoundary, durations());
  clearSleepTimer();
  audio.pause();
  if (target.index === index && !target.atFileEnd) audio.currentTime = target.positionMs / 1000;
  emit();
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
    sleepTimerRemainingMs:
      sleepBoundary !== null ? Math.max(0, untilBoundary() ?? 0) : sleepRemainingMs,
    sleepTimerMode: sleepMode,
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
  if (playing() && sleepMode === 'minutes' && sleepRemainingMs !== null) {
    sleepRemainingMs = Math.max(0, sleepRemainingMs - elapsed);
    if (element) element.volume = fadeVolume(sleepRemainingMs);
    if (sleepRemainingMs === 0) {
      element?.pause();
      clearSleepTimer();
    }
  }
  const left = untilBoundary();
  if (playing() && left !== null && sleepBoundary !== null) {
    if (element) element.volume = fadeVolume(left);
    const target = sleepFileTarget(sleepBoundary, durations());
    // Inside a file the timer stops on a timeout set just before the boundary; a file's own end
    // is caught by 'ended'.
    if (!target.atFileEnd && target.index === index && left < TICK_MS * 1.5 && !boundaryStop) {
      boundaryStop = setTimeout(stopAtBoundary, Math.max(0, left));
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
  // A retired element (see retire) still fires events while it unloads; only the current one counts.
  const on = (type: keyof HTMLMediaElementEventMap, listener: () => void) =>
    audio.addEventListener(type, () => {
      if (audio === element) listener();
    });
  on('play', () => {
    ended = false;
    seekingForLoad = false;
    startTicker();
    emit();
  });
  on('timeupdate', () => {
    if (audio.readyState > 0 && !audio.error) {
      skipOutro(audio);
      lastPositionMs = positionMs();
      lastPlaying = playing();
    }
  });
  on('pause', () => {
    clearBoundaryStop();
    pausedAt = Date.now();
    placeChangedAt = pausedAt;
    writeJournal();
    stopTicker();
    emit();
  });
  on('waiting', () => {
    buffering = true;
    emit();
  });
  on('playing', () => {
    buffering = false;
    linkRefreshed = false;
    emit();
  });
  on('seeked', () => {
    if (seekingForLoad) seekingForLoad = false;
    else {
      placeChangedAt = Date.now();
      writeJournal();
      // A seek into another chapter moves a chapter timer to that chapter's end.
      placeBoundary();
    }
    emit();
  });
  on('error', () => {
    const file = book?.files[index];
    // An expired link: ask the stream (its `/resolve/…` URL) again, once, at the same place.
    if (file && audio.error && shouldRefreshLink(audio.error.code, file.uri, linkRefreshed)) {
      linkRefreshed = true;
      note('link-refreshed');
      void setPart(index, lastPositionMs, lastPlaying);
      return;
    }
    error = audio.error ? `Media error ${audio.error.code}: ${audio.error.message}` : 'Cannot play';
    note('error', audio.error?.code ?? null);
    emit();
  });
  on('ended', () => {
    const target = sleepBoundary !== null ? sleepFileTarget(sleepBoundary, durations()) : null;
    const sleepsHere = target !== null && target.atFileEnd && target.index === index;
    if (book && index < book.files.length - 1) {
      if (sleepsHere) {
        // The chapter ended with its file: stop, with the place at the start of the next one.
        clearSleepTimer();
        void setPart(index + 1, 0, false);
      } else void setPart(index + 1, 0, true);
    } else {
      placeChangedAt = Date.now();
      writeJournal();
      // As on Android: log the end, and an episode hands over to Up Next.
      if (book) finished.push({ bookId: book.bookId, at: Date.now() });
      // A timer for the end of the episode stops here, before Up Next.
      const next = book?.handsOver && !sleepsHere ? queue.shift() : undefined;
      if (sleepsHere) {
        clearSleepTimer();
      }
      if (next) {
        void load(next, true);
        return;
      }
      ended = true;
      stopTicker();
      emit();
    }
  });
  if (!pageHideListened) window.addEventListener('pagehide', writeJournal);
  pageHideListened = true;
  setUpMediaSession();
  element = audio;
  return audio;
}

let pageHideListened = false;

/**
 * Ends a podcast episode where its outro starts (M45), as the Android service does: only when
 * playback runs across that place, so a listener who seeks into the outro hears it.
 */
function skipOutro(audio: HTMLAudioElement): void {
  const last = (book?.files.length ?? 0) - 1;
  if (!book || index !== last || !book.skipOutroMs || audio.paused) return;
  const durationMs = Number.isFinite(audio.duration)
    ? Math.round(audio.duration * 1000)
    : (book.files[last]?.durationMs ?? 0);
  const at = outroStartMs(durationMs, book.skipOutroMs, book.skipIntroMs ?? 0, last === 0);
  const now = positionMs();
  // Seeks jump further than playback moves between two time updates.
  if (at !== null && lastPositionMs < at && now >= at && now - lastPositionMs < 2_000) {
    audio.currentTime = durationMs / 1000;
  }
}

/** Lets the element go, so the next part gets a fresh one: a routed element cannot be unrouted. */
function retire(): void {
  const old = element;
  if (!old) return;
  element = null;
  old.pause();
  old.removeAttribute('src');
  old.load();
  sound.release(old);
}

/** The element for a source: routed through the sound effects when they are on and may read it. */
async function playerFor(src: string): Promise<HTMLAudioElement> {
  const routed = sound.soundOn(settings) && (await sound.canRoute(src));
  if (element && sound.isRouted(element) !== routed) retire();
  const audio = player();
  if (routed && !sound.isRouted(audio)) {
    audio.crossOrigin = 'anonymous';
    sound.route(audio, settings);
  }
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
  if (i !== index) linkRefreshed = false;
  index = i;
  ended = false;
  error = null;
  lastPositionMs = startMs;
  lastPlaying = autoplay;
  const src = await sourceFor(file.uri);
  const audio = await playerFor(src);
  audio.src = src;
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
  if (autoplay) {
    await sound.resume(audio);
    await audio.play().catch(() => {});
  }
  emit();
}

export async function load(next: BookLoad, autoplay: boolean): Promise<void> {
  book = next;
  pausedAt = next.pausedAt;
  placeChangedAt = next.pausedAt ?? 0;
  const rewind =
    autoplay && settings.smartRewind && pausedAt !== null
      ? rewindOnResume(Date.now() - pausedAt)
      : 0;
  const start = trimmedStart(next.startIndex, next.startPositionMs, rewind, next.skipIntroMs ?? 0);
  // A chapter timer carries over to the new book's chapter.
  sleepBoundary = null;
  clearBoundaryStop();
  await setPart(next.startIndex, start, autoplay);
  placeBoundary();
}

export async function seekTo(i: number, ms: number): Promise<void> {
  if (!book) return;
  if (i === index && element) element.currentTime = Math.max(0, ms) / 1000;
  else {
    await setPart(i, Math.max(0, ms), playing());
    placeBoundary();
  }
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
  if (ended) await setPart(0, book.skipIntroMs ?? 0, false);
  if (settings.smartRewind && pausedAt !== null) {
    const at = positionMs();
    // Not back into a skipped intro once past it, as on Android.
    const intro = book.skipIntroMs && at >= book.skipIntroMs ? book.skipIntroMs : 0;
    element.currentTime =
      trimmedStart(index, at, rewindOnResume(Date.now() - pausedAt), intro) / 1000;
  }
  pausedAt = null;
  await sound.resume(element);
  await element.play().catch((e: unknown) => {
    error = e instanceof Error ? e.message : String(e);
    note('play-refused', e instanceof Error ? (PLAY_REFUSED[e.name] ?? 0) : 0);
    emit();
  });
}

export async function pause(): Promise<void> {
  element?.pause();
}

/** Moves along the whole book, across files. */
export async function seekBy(deltaMs: number): Promise<void> {
  await seekToBook(offsetOf(index) + positionMs() + deltaMs);
}

async function seekToBook(bookMs: number): Promise<void> {
  if (!book) return;
  const total = offsetOf(book.files.length);
  const target = Math.max(0, Math.min(total - 1, bookMs));
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
  const audio = element;
  if (audio && sound.isRouted(audio)) sound.update(audio, next);
  else if (audio && book && sound.soundOn(next) && (await sound.canRoute(audio.currentSrc))) {
    // A plain element cannot take the effects: reload the part, routed, at the same place.
    await setPart(index, positionMs(), playing());
  }
  emit();
}

export async function skip(forward: boolean): Promise<void> {
  await seekBy(forward ? settings.skipIntervalMs : -settings.skipIntervalMs);
}

export async function startSleepTimer(minutes: number): Promise<void> {
  clearSleepTimer();
  sleepMode = 'minutes';
  sleepRemainingMs = minutes * 60_000;
  emit();
}

export async function startSleepTimerAtEnd(mode: 'chapter' | 'episode'): Promise<void> {
  if (!book) return;
  clearSleepTimer();
  sleepMode = mode;
  placeBoundary();
  emit();
}

export async function cancelSleepTimer(): Promise<void> {
  clearSleepTimer();
  emit();
}

export async function setQueue(next: BookLoad[]): Promise<void> {
  queue = [...next];
}

// The web player runs inside the app, which saves every place itself; there is no car here.
export async function takeEarlierPlaces(): Promise<JournalEntry[]> {
  return [];
}

// Only while the tab is open, so the app counts listening and scrobble sessions itself.
export const countsInService = false;

export async function takeAccounting(): Promise<ServiceAccounting> {
  return { epoch: '', records: [] };
}

export async function settleAccounting(): Promise<void> {}

export async function ackAccounting(epoch: string, through: number): Promise<void> {
  void epoch;
  void through;
}

export async function setCarLibrary(library: CarLibrary): Promise<void> {
  void library;
}

// Bedtime timers start in the Android service; the web player has no such setting.
export async function setBedtime(bedtime: Bedtime | null): Promise<void> {
  void bedtime;
}

export async function takeFinished(): Promise<FinishedItem[]> {
  const list = finished;
  finished = [];
  return list;
}

export async function setDiagnostics(on: boolean): Promise<void> {
  diagnosticsOn = on;
  if (!on) diagnostics = [];
}

export async function takeDiagnostics(): Promise<PlayerDiagnostic[]> {
  const list = diagnostics;
  diagnostics = [];
  return list;
}

export async function unload(): Promise<void> {
  writeJournal();
  element?.pause();
  if (element) element.removeAttribute('src');
  book = null;
  index = -1;
  ended = false;
  clearSleepTimer();
  clearMediaSession();
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
  // The browser's media overlay and the system's media controls can drag within the chapter (the
  // whole book without chapters) and stop.
  const optional: [MediaSessionAction, MediaSessionActionHandler][] = [
    [
      'seekto',
      (details) => {
        if (details.seekTime !== undefined) {
          const ms = Math.max(0, details.seekTime) * 1000;
          // Without the book's durations the bar is the file, and so is the seek.
          if (offsetOf(book?.files.length ?? 0) > 0) void seekToBook(shownSpanStart + ms);
          else void seekTo(index, ms);
        }
      },
    ],
    ['stop', () => void pause()],
  ];
  for (const [action, handler] of optional) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Older browsers throw on actions they don't know.
    }
  }
}

let shownMeta = '';
// Where the stretch the system controls show starts on the book's timeline, for their seeks.
let shownSpanStart = 0;

/** Nothing loaded: the system controls let go of the last book and its progress. */
function clearMediaSession(): void {
  shownMeta = '';
  shownSpanStart = 0;
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  try {
    navigator.mediaSession.setPositionState();
  } catch {
    // Not every browser has position state.
  }
}

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
  // The chapter, as the Player's bar shows it; the file when the book's durations are unknown.
  const bookMs = offsetOf(index) + now.positionMs;
  const total = offsetOf(book.files.length);
  const span =
    total > 0
      ? mediaSpan(book.chapters, total, bookMs)
      : { startMs: offsetOf(index), lengthMs: now.durationMs };
  if (span.lengthMs > 0 && now.speed > 0) {
    shownSpanStart = span.startMs;
    try {
      navigator.mediaSession.setPositionState({
        duration: span.lengthMs / 1000,
        position: Math.min(Math.max(0, bookMs - span.startMs), span.lengthMs) / 1000,
        playbackRate: now.speed,
      });
    } catch {
      // Not every browser has position state; the controls work without it.
    }
  }
}

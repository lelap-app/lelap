import type {
  Bedtime,
  BookLoad,
  CarLibrary,
  FinishedItem,
  JournalEntry,
  PlayerDiagnostic,
  PlayerSettings,
  PlayerState,
  QueueList,
  ServiceAccounting,
  SleepPlace,
  SleepTimerMode,
} from '@lelap/audio';
import {
  chapterImageAt,
  chooseSound,
  fadeVolume,
  mediaSpan,
  outroStartMs,
  PLAY_REFUSED,
  replayGainDb,
  shouldRefreshLink,
  sleepBoundaryMs,
  sleepFileTarget,
  sleepRemainingMs as remainingToBoundary,
  trimmedStart,
} from '@lelap/core';

import { t } from '../i18n';
import { OPFS_SCHEME, opfsImageUrl } from '../webCovers';
import * as opfs from './opfs';
import * as sound from './webaudio';
import { blobBytes, type FileBytes, readHead, urlBytes } from './webfile';
import { createSilenceSkipper } from './websilence';

export type {
  Bedtime,
  BookLoad,
  CarLibrary,
  FinishedItem,
  JournalEntry,
  PlayerDiagnostic,
  PlayerSettings,
  PlayerState,
  QueueList,
  ServiceAccounting,
  SleepPlace,
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
  duckPercent: 20,
  skipIntervalMs: 30_000,
  smartRewind: true,
  mono: false,
  voiceEq: false,
  volumeBoost: false,
  skipSilence: false,
  evenLoudness: false,
  shakeToExtend: false,
};

/** The effects for the book loaded: its own choices over the listener's defaults (M84, M101). */
const effects = (): sound.SoundSettings => {
  const chosen = chooseSound(book?.sound, settings);
  return {
    mono: settings.mono,
    volumeBoost: settings.volumeBoost,
    voiceEq: chosen.voiceEq,
    evenLoudness: chosen.evenLoudness,
  };
};

const skipsSilence = () => chooseSound(book?.sound, settings).skipSilence;
// Skip silence and even loudness read the file's first bytes; nothing else does.
const readsFile = () => skipsSilence() || effects().evenLoudness;

// Listening time skip silence saved per book (M101), kept in this browser like Android keeps it
// on the phone; the newest books stay.
const SILENCE_KEY = 'lelap.silenceSaved';
const SILENCE_BOOKS = 300;

function readSavings(): [string, number][] {
  try {
    const raw = localStorage.getItem(SILENCE_KEY);
    return raw ? (JSON.parse(raw) as [string, number][]) : [];
  } catch {
    return [];
  }
}

// Saved in memory as it adds up and written with the journal, not with every pause.
let savings: Map<string, number> | null = null;
let savingsChanged = false;

function addSaved(ms: number): void {
  const id = book?.bookId;
  if (!id || ms <= 0) return;
  savings ??= new Map(readSavings());
  const total = (savings.get(id) ?? 0) + ms;
  // The book saved to last moves to the end, so the oldest one goes first.
  savings.delete(id);
  savings.set(id, total);
  while (savings.size > SILENCE_BOOKS) savings.delete(savings.keys().next().value ?? '');
  savingsChanged = true;
}

function writeSavings(): void {
  if (!savings || !savingsChanged) return;
  savingsChanged = false;
  try {
    localStorage.setItem(SILENCE_KEY, JSON.stringify([...savings]));
  } catch {
    // Storage full or blocked: the time saved is only shown, nothing depends on it.
  }
}

const skipper = createSilenceSkipper(addSaved);
// Counts loads of a part, so a file's tags read late don't reach the next part.
let partLoads = 0;
// The part whose first bytes were read; they are read only once an effect needs them.
let partRead = -1;
let partSource: { audio: HTMLAudioElement; src: string; blob: Blob | null } | null = null;
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

// The listening speed: inside a pause skip silence plays the element faster than this.
const speedNow = () => book?.speed ?? 1;

function untilBoundary(): number | null {
  if (sleepBoundary === null) return null;
  return remainingToBoundary(sleepBoundary, offsetOf(index) + positionMs(), speedNow());
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
    speed: element ? speedNow() : 1,
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
  writeSavings();
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
    error = mediaErrorText(audio.error?.code ?? null);
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
  skipper.detach();
  old.pause();
  old.removeAttribute('src');
  old.load();
  sound.release(old);
}

/** The element for a source: routed through the sound effects when they are on and may read it. */
async function playerFor(src: string): Promise<HTMLAudioElement> {
  const routed = sound.soundOn(effects()) && (await sound.canRoute(src));
  if (element && sound.isRouted(element) !== routed) retire();
  const audio = player();
  if (routed && !sound.isRouted(audio)) {
    audio.crossOrigin = 'anonymous';
    sound.route(audio, effects());
  }
  // Another book may have its own voice boost.
  if (routed) sound.update(audio, effects());
  return audio;
}

/** A downloaded file is read from OPFS; anything else plays from its URL. */
async function sourceFor(uri: string): Promise<{ src: string; blob: Blob | null }> {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  if (!uri.startsWith('file://')) return { src: uri, blob: null };
  const blob = await opfs.readFile(uri.slice('file://'.length));
  objectUrl = URL.createObjectURL(blob);
  return { src: objectUrl, blob };
}

/**
 * Reads the part's first bytes for its ReplayGain and its MP3 layout (M101), while it starts
 * playing: a download from OPFS, a stream only from a host that allows reading it.
 */
async function readPart(audio: HTMLAudioElement, src: string, blob: Blob | null): Promise<void> {
  const load = partLoads;
  if (partRead === load) return;
  partRead = load;
  const file: FileBytes | null = blob
    ? blobBytes(blob)
    : (await sound.canRoute(src))
      ? urlBytes(src)
      : null;
  const head = file ? await readHead(file).catch(() => null) : null;
  if (load !== partLoads || audio !== element) return;
  sound.setTagGain(audio, head ? replayGainDb(head.tags) : null);
  skipper.attach(audio, file, head?.layout ?? null);
  skipper.setOn(skipsSilence());
  note(head?.layout ? 'silence-map' : 'silence-none');
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
  partLoads++;
  const { src, blob } = await sourceFor(file.uri);
  const audio = await playerFor(src);
  // Until the new file is read, it plays at the listening speed without skipping.
  skipper.attach(audio, null, null);
  audio.src = src;
  skipper.setSpeed(audio, speedNow());
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
  partSource = { audio, src, blob };
  if (readsFile()) void readPart(audio, src, blob);
  if (autoplay) {
    await sound.resume(audio);
    await audio.play().catch(() => {});
  }
  emit();
}

export async function load(next: BookLoad, autoplay: boolean): Promise<void> {
  // Time saved so far belongs to the book that played; the next one is measured afresh.
  skipper.detach();
  if (book?.bookId !== next.bookId) {
    sound.restartLoudness();
    sound.setTagGain(element, null);
  }
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

/**
 * The line under the player for a `MediaError` code. The browser's own message is English for
 * developers, so only the kind of failure is shown; diagnostics keep the code.
 */
function mediaErrorText(code: number | null): string {
  if (code === 2) return t('No answer from the server.');
  if (code === 3)
    return t('This file can’t be read. It may be damaged, or in a format Lelap does not play.');
  return t('The file could not be played. Press play to try again.');
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
    error =
      e instanceof Error && e.name === 'NotAllowedError'
        ? t('The browser did not let playback start. Press play again.')
        : mediaErrorText(e instanceof Error && e.name === 'NotSupportedError' ? 3 : null);
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
  skipper.setSpeed(element, speed);
  emit();
}

export async function setSettings(next: PlayerSettings): Promise<void> {
  settings = next;
  await applyEffects();
  emit();
}

/** Gives the loaded book its new sound (M84) at its place; another book is left alone. */
export async function updateBook(next: BookLoad): Promise<void> {
  if (!book || book.bookId !== next.bookId) return;
  // Its own sound, and whether it hands over: a list that starts or stops playing (M112).
  // Its chapter pictures too, once read (M121).
  book = {
    ...book,
    sound: next.sound ?? {},
    handsOver: next.handsOver ?? false,
    ...(next.artworks ? { artworks: next.artworks } : {}),
  };
  // The same chapters named in another language (M124); other changes wait for the next load.
  const chapters = book.chapters;
  if (
    next.chapters.length === chapters.length &&
    next.chapters.every((c, i) => c.startMs === chapters[i]?.startMs)
  ) {
    book = { ...book, chapters: next.chapters };
  }
  await applyEffects();
  emit();
}

async function applyEffects(): Promise<void> {
  const audio = element;
  const now = effects();
  skipper.setOn(skipsSilence());
  const part = partSource;
  if (part && part.audio === audio && readsFile()) void readPart(part.audio, part.src, part.blob);
  if (audio && sound.isRouted(audio)) sound.update(audio, now);
  else if (audio && book && sound.soundOn(effects()) && (await sound.canRoute(audio.currentSrc))) {
    // A plain element cannot take the effects: reload the part, routed, at the same place.
    await setPart(index, positionMs(), playing());
  }
}

/** Listening time skip silence saved in the book in this browser. */
export async function silenceSavedMs(bookId: string): Promise<number> {
  savings ??= new Map(readSavings());
  return Math.round(savings.get(bookId) ?? 0);
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

// The list's steps go through the app on the web (`setListKeys`), so the list itself is unused.
export async function setQueue(
  next: BookLoad[],
  listNext: number | null = null,
  list: QueueList | null = null,
): Promise<void> {
  void listNext;
  void list;
  queue = [...next];
}

/** The list's steps for the media keys (M119); the app moves through the list itself. */
export type ListKeys = { previous: boolean; next: boolean; step: (forward: boolean) => void };

let listKeys: ListKeys | null = null;

/** While a list plays, ⏮ and ⏭ go to its previous and next item; null gives them back. */
export function setListKeys(keys: ListKeys | null): void {
  listKeys = keys;
}

// Android Auto is not on the web.
export async function takeListStarted(): Promise<null> {
  return null;
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

// Back to where you last used the player after the timer stopped (M86): Android only, like the
// bedtime routine.
export async function getSleepPlace(): Promise<SleepPlace | null> {
  return null;
}

export async function clearSleepPlace(): Promise<void> {}

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
  skipper.detach();
  writeJournal();
  writeSavings();
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
  // ⏮ and ⏭ skip by the interval, as on Android's lock screen; while a list plays they step
  // through it (M119), and the browser's seek buttons beside them keep the skip by time.
  session.setActionHandler('previoustrack', () =>
    listKeys?.previous ? listKeys.step(false) : void skip(false),
  );
  session.setActionHandler('nexttrack', () =>
    listKeys?.next ? listKeys.step(true) : void skip(true),
  );
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
  const bookMs = offsetOf(index) + now.positionMs;
  // The chapter's picture while it plays, as on the phone's lock screen (M121).
  const picture = book.artworks
    ? chapterImageAt(
        book.artworks.map((a) => ({ startMs: a.startMs, img: a.uri })),
        bookMs,
      )
    : null;
  const key = `${book.bookId} ${now.partTitle ?? ''} ${picture ?? ''}`;
  if (key !== shownMeta) {
    shownMeta = key;
    const given =
      picture ?? (book.coverUri && !book.coverUri.startsWith('file://') ? book.coverUri : null);
    // A cover kept in OPFS needs a blob URL first; it is added once that is ready.
    const kept = given?.startsWith(OPFS_SCHEME) ? given.slice(OPFS_SCHEME.length) : null;
    const cover = kept ? null : given;
    const metadata = new MediaMetadata({
      title: now.partTitle ?? book.title,
      artist: book.author ?? '',
      album: book.title,
      artwork: cover ? [{ src: cover }] : [],
    });
    navigator.mediaSession.metadata = metadata;
    if (kept) {
      void opfsImageUrl(kept).then((url) => {
        if (url && navigator.mediaSession.metadata === metadata) metadata.artwork = [{ src: url }];
      });
    }
  }
  navigator.mediaSession.playbackState = now.playing ? 'playing' : 'paused';
  // The chapter, as the Player's bar shows it; the file when the book's durations are unknown.
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

// For checking skip silence and even loudness from a dev build's console (M101).
if (__DEV__) {
  Object.assign(globalThis, {
    lelapSound: {
      loudness: () => sound.loudnessState(element),
      fast: () => skipper.fast,
      pauseAfter: (ms: number) => skipper.map?.nextPause(ms, 30_000) ?? null,
      rate: () => element?.playbackRate ?? null,
      placeMs: () => positionMs(),
    },
  });
}

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
  HistoryItem,
  SleepTimerMode,
} from '@lelap/audio';
import {
  chapterImageAt,
  chooseSound,
  fadeVolume,
  isHls,
  mediaSpan,
  outroStartMs,
  pastPart,
  PLAY_REFUSED,
  preparingRetryAt,
  type ProbeFetcher,
  probeStream,
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
import { blobBytes, type FileBytes, type FileHead, openTrack, readHead, urlBytes } from './webfile';
import { attachHls, detachHls, watchNowPlaying } from './webhls';
import { createSilenceSkipper } from './websilence';
import * as tee from './webtee';

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
  HistoryItem,
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
// The playback history's actions from the browser's media keys and the sleep timer (M138); the
// app logs its own taps.
let history: HistoryItem[] = [];
let index = -1;
let ended = false;
let buffering = false;
let error: string | null = null;
// Audio its source is still making (M155): when the player asks again, and when it first said so.
let preparingUntil: number | null = null;
let preparingSince: number | null = null;
let preparingTimer: ReturnType<typeof setTimeout> | null = null;
const probeFetch: ProbeFetcher = (url, init) => fetch(url, init);
let pausedAt: number | null = null;
/** What a live stream plays now (M154). */
let nowPlaying: string | null = null;
const live = () => book?.live === true;
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

// Skip silence reads the file as it plays here, so it rests while a receiver plays (M125).
// A live stream never ends, so nothing reads its bytes (M154).
const skipsSilence = () => chooseSound(book?.sound, settings).skipSilence && !remoting() && !live();
// Skip silence and even loudness read the file's first bytes; nothing else does.
const readsFile = () => !live() && (skipsSilence() || effects().evenLoudness);

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
// The part whose first bytes were read; they are read only once an effect needs them. Skip
// silence's tables (an M4B's can be megabytes) only once it is on.
let partRead = -1;
let partTracked = -1;
let partHead: { file: FileBytes | null; head: FileHead | null } | null = null;
let partSource: { audio: HTMLAudioElement; src: string; blob: Blob | null } | null = null;
// The part whose file the element holds: while the next one loads, its length is still the last's.
let loadedIndex = -1;
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
const HISTORY_LIMIT = 200;
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

const bookPlace = () => offsetOf(index) + positionMs();

function keep(action: string, source: string, fromMs: number, toMs: number): void {
  if (!book) return;
  history.push({ bookId: book.bookId, action, source, at: Date.now(), fromMs, toMs });
  if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
}

/** The sleep timer stopped playback here, for “Back to when you last used it” (M86, M138). */
function keepSleepStop(atMs = bookPlace()): void {
  keep('sleep', 'timer', atMs, atMs);
}

/** A media key's action, kept in the history with the place before and after it. */
function byKey(action: string, run: () => Promise<void>): () => void {
  return () => {
    const bookId = book?.bookId;
    const from = bookPlace();
    void run().then(() => {
      if (book && book.bookId === bookId) keep(action, 'keys', from, bookPlace());
    });
  };
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
  keepSleepStop(offsetOf(target.index) + target.positionMs);
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
  const duration =
    element && loadedIndex === index && Number.isFinite(element.duration)
      ? element.duration * 1000
      : 0;
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
    durationMs: live() ? 0 : duration || file?.durationMs || 0,
    speed: element && !live() ? speedNow() : 1,
    duckOnInterruption: settings.duckOnInterruption,
    waitingForCall: false,
    sleepTimerRemainingMs:
      sleepBoundary !== null ? Math.max(0, untilBoundary() ?? 0) : sleepRemainingMs,
    sleepTimerMode: sleepMode,
    error,
    preparingUntil,
    live: live(),
    nowPlaying: live() ? nowPlaying : null,
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
      keepSleepStop();
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
    const code = audio.error?.code ?? null;
    const load = partLoads;
    // The element can't tell a 503 from any other failure: the address itself says.
    void preparingAnswer(index, audio.src).then((handled) => {
      if (handled || load !== partLoads) return;
      error = mediaErrorText(code);
      note('error', code);
      emit();
    });
  });
  on('ended', () => {
    // A live stream that stopped (the station went off air) is not finished, and hands over to
    // nothing (M154).
    if (live()) {
      ended = true;
      stopTicker();
      emit();
      return;
    }
    const target = sleepBoundary !== null ? sleepFileTarget(sleepBoundary, durations()) : null;
    const sleepsHere = target !== null && target.atFileEnd && target.index === index;
    if (book && index < book.files.length - 1) {
      if (sleepsHere) {
        // The chapter ended with its file: stop, with the place at the start of the next one.
        clearSleepTimer();
        keepSleepStop(offsetOf(index + 1));
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
        keepSleepStop(offsetOf(book?.files.length ?? 0));
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
  watchNowPlaying(audio, (line) => {
    if (audio !== element || !live() || line === nowPlaying) return;
    nowPlaying = line;
    emit();
  });
  setUpMediaSession();
  element = audio;
  watchRemote(audio);
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
  detachHls();
  old.pause();
  old.removeAttribute('src');
  old.load();
  sound.release(old);
}

// Casting from the browser (M125) through the Remote Playback API: Chrome's Cast and Safari's
// AirPlay. The browser lists the speakers and asks the listener; the page only learns whether one
// is reachable and whether the element plays there. A remote session belongs to one element, so
// while it lasts the element is kept for every part and the sound effects stay off: a receiver
// plays the file itself, and an element routed through them can't be unrouted.

/** Whether the browser can reach a speaker for the element, and whether it plays there. */
export type WebCast = { available: boolean; state: RemotePlaybackState };

let webCast: WebCast = { available: false, state: 'disconnected' };
const webCastListeners = new Set<(cast: WebCast) => void>();
let watchedRemote: RemotePlayback | null = null;
// The element was taken out of the sound effects for casting, so they come back after.
let leftEffects = false;

const remoteOf = (audio: HTMLAudioElement | null): RemotePlayback | null =>
  audio && 'remote' in audio && audio.remote ? audio.remote : null;

function remoting(): boolean {
  return webCast.state !== 'disconnected';
}

function setWebCast(next: Partial<WebCast>): void {
  const merged = { ...webCast, ...next };
  if (merged.available === webCast.available && merged.state === webCast.state) return;
  const was = remoting();
  webCast = merged;
  if (was !== remoting()) remoteChanged();
  for (const listener of webCastListeners) listener(webCast);
}

/** Follows the new element's remote playback; the one before is let go. */
function watchRemote(audio: HTMLAudioElement): void {
  const remote = remoteOf(audio);
  watchedRemote?.cancelWatchAvailability().catch(() => {});
  watchedRemote = remote;
  if (!remote) {
    setWebCast({ available: false, state: 'disconnected' });
    return;
  }
  const follow = () => {
    if (audio === element) setWebCast({ state: remote.state });
  };
  remote.addEventListener('connecting', follow);
  remote.addEventListener('connect', follow);
  remote.addEventListener('disconnect', follow);
  setWebCast({ state: remote.state });
  // Browsers that can't watch (some phones) still offer the prompt.
  remote
    .watchAvailability((available) => {
      if (audio === element) setWebCast({ available });
    })
    .catch((e: unknown) => {
      if (audio === element) {
        setWebCast({ available: e instanceof DOMException && e.name === 'NotSupportedError' });
      }
    });
}

function remoteChanged(): void {
  skipper.setOn(skipsSilence());
  if (!remoting()) restoreEffects();
}

/** Back on this device: the part loads again at its place, so the sound effects apply once more. */
function restoreEffects(): void {
  if (!leftEffects) return;
  leftEffects = false;
  if (book && element && sound.soundOn(effects()) && !sound.isRouted(element)) {
    void setPart(index, positionMs(), playing());
  }
}

/** A fresh element, not routed, at the same place of the same part: one that can be cast. */
function unrouted(old: HTMLAudioElement): HTMLAudioElement {
  const source = partSource;
  if (!source || source.audio !== old) return old;
  const at = old.currentTime;
  const wasPlaying = playing();
  retire();
  const audio = player();
  audio.crossOrigin = null;
  audio.src = source.src;
  seekingForLoad = true;
  // Before the metadata loads this sets where it starts.
  audio.currentTime = at;
  skipper.attach(audio, null, null);
  skipper.setSpeed(audio, speedNow());
  partSource = { ...source, audio };
  leftEffects = true;
  if (wasPlaying) void audio.play().catch(() => {});
  return audio;
}

export function webCastState(): WebCast {
  return webCast;
}

export function addWebCastListener(listener: (cast: WebCast) => void): Subscription {
  webCastListeners.add(listener);
  return { remove: () => webCastListeners.delete(listener) };
}

/**
 * Shows the browser's list of speakers for the book playing, or its controls for the one that
 * plays. Call it straight from a tap: browsers only show the list for one.
 */
export async function promptWebCast(): Promise<void> {
  let audio = element;
  if (!audio || !book) throw new Error(t('Start a book first, then cast it.'));
  // Taken out of the sound effects first, without waiting, so the tap still counts.
  const swapped = !remoting() && sound.isRouted(audio);
  if (swapped) audio = unrouted(audio);
  const remote = remoteOf(audio);
  if (!remote) throw new Error(t('This browser can’t cast.'));
  try {
    await remote.prompt();
    // Some browsers resolve when their list closes without a choice: nothing casts, so the
    // effects come back.
    if (swapped && !remoting()) restoreEffects();
  } catch (e) {
    // Cancelled: the effects come back.
    if (swapped && !remoting()) restoreEffects();
    if (e instanceof DOMException && e.name === 'NotAllowedError') return;
    if (e instanceof DOMException && e.name === 'NotFoundError') {
      throw new Error(t('No speakers or TVs found. Check that they’re on the same Wi-Fi.'), {
        cause: e,
      });
    }
    if (e instanceof DOMException && e.name === 'NotSupportedError') {
      throw new Error(
        t('This book can’t be cast from the browser. Downloaded books play only here.'),
        { cause: e },
      );
    }
    throw e;
  }
}

/** The element for a source: routed through the sound effects when they are on and may read it. */
async function playerFor(src: string): Promise<HTMLAudioElement> {
  const readable = await sound.canRoute(src);
  // A receiver plays on the element it was given, which keeps it whatever the effects say.
  const routed = !remoting() && sound.soundOn(effects()) && readable;
  if (element && !remoting() && sound.isRouted(element) !== routed) retire();
  const audio = player();
  // Skip silence reads the bytes the element streams (M122), which needs a CORS request.
  if (!routed) audio.crossOrigin = readable && skipsSilence() ? 'anonymous' : null;
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
 * Reads the part's first bytes for its ReplayGain and where its sound lies (M101, M122), while it
 * starts playing: a download from OPFS, a stream only from a host that allows reading it.
 */
async function readPart(audio: HTMLAudioElement, src: string, blob: Blob | null): Promise<void> {
  const load = partLoads;
  if (partRead !== load) {
    partRead = load;
    partHead = null;
    const file: FileBytes | null = blob
      ? blobBytes(blob)
      : (await sound.canRoute(src))
        ? urlBytes(src)
        : null;
    const head = file ? await readHead(file).catch(() => null) : null;
    if (load !== partLoads || audio !== element) return;
    partHead = { file, head };
    sound.setTagGain(audio, head ? replayGainDb(head.tags) : null);
  }
  const read = partHead;
  if (!read || partTracked === load || !skipsSilence()) return;
  partTracked = load;
  const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
  const track =
    read.file && read.head
      ? await openTrack(read.file, read.head, durationMs).catch(() => null)
      : null;
  if (load !== partLoads || audio !== element) return;
  skipper.attach(audio, read.file, track);
  skipper.setOn(skipsSilence());
  note(track ? 'silence-map' : 'silence-none');
}

function clearPreparing(): void {
  if (preparingTimer) clearTimeout(preparingTimer);
  preparingTimer = null;
  preparingUntil = null;
  preparingSince = null;
}

/**
 * After the element failed on a part from the web: whether its source is still preparing it
 * (M155), as the item page asks (M152). It then shows “Preparing…” and opens the part again when
 * told, for up to 10 minutes, or says the source's own words for a part that won't come. False
 * leaves the element's own error. A server without CORS can't be asked, so its error stays.
 */
async function preparingAnswer(i: number, src: string): Promise<boolean> {
  const file = book?.files[i];
  if (!book || !file || live() || !/^https?:\/\//i.test(src)) return false;
  const load = partLoads;
  const answer = await probeStream(probeFetch, src, Date.now(), book.headers ?? {});
  if (load !== partLoads) return true;
  if (answer.state === 'gone') {
    if (!answer.message) return false;
    clearPreparing();
    error = answer.message;
    note('error', answer.status);
    emit();
    return true;
  }
  if (answer.state !== 'preparing') return false;
  const now = Date.now();
  preparingSince ??= now;
  const at = preparingRetryAt(preparingSince, now, answer.seconds);
  if (at === null) {
    clearPreparing();
    error = t(
      'The source is still getting this book ready. Try again later, or download it when ready.',
    );
    note('error', 503);
    emit();
    return true;
  }
  preparingUntil = at;
  error = null;
  buffering = true;
  emit();
  if (preparingTimer) clearTimeout(preparingTimer);
  preparingTimer = setTimeout(() => {
    preparingTimer = null;
    if (load === partLoads) void setPart(i, lastPositionMs, lastPlaying);
  }, at - now);
  return true;
}

async function setPart(i: number, startMs: number, autoplay: boolean): Promise<void> {
  const file = book?.files[i];
  if (!file) return;
  if (i !== index) {
    linkRefreshed = false;
    clearPreparing();
  }
  index = i;
  loadedIndex = -1;
  ended = false;
  error = null;
  lastPositionMs = startMs;
  lastPlaying = autoplay;
  partLoads++;
  // The last part's error is gone; a copy's fallback tells its own error from that one (M155).
  emit();
  const { src, blob } = await sourceFor(file.uri);
  const audio = await playerFor(src);
  // Until the new file is read, it plays at the listening speed without skipping.
  skipper.attach(audio, null, null);
  // The service worker passes the stream on from the element's first request.
  if (!blob && audio.crossOrigin && skipsSilence()) await tee.watch(src);
  const hls = !blob && isHls(file.uri, file.mime);
  if (!hls) {
    detachHls();
    audio.src = src;
  }
  skipper.setSpeed(audio, live() ? 1 : speedNow());
  await new Promise<void>((resolve) => {
    const ready = () => {
      audio.removeEventListener('loadedmetadata', ready);
      resolve();
    };
    audio.addEventListener('loadedmetadata', ready);
    audio.addEventListener('error', ready, { once: true });
    if (hls) attachHls(audio, src).catch(ready);
    else audio.load();
  });
  if (!audio.error) {
    buffering = false;
    clearPreparing();
  }
  // A seek into a part whose length nobody knew goes on past its end, now that it is known
  // (M155), as if every length had been.
  const lengthMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
  const past =
    book && !live() && !audio.error && !(file.durationMs > 0)
      ? pastPart(
          book.files.map((f) => f.durationMs),
          i,
          startMs,
          lengthMs,
        )
      : null;
  if (past && past.index !== i) return setPart(past.index, past.positionMs, autoplay);
  // A live stream starts at what is on air.
  if (!live()) {
    seekingForLoad = true;
    audio.currentTime = (past?.positionMs ?? startMs) / 1000;
  }
  partSource = { audio, src, blob };
  loadedIndex = i;
  if (readsFile()) void readPart(audio, src, blob);
  if (autoplay) {
    await sound.resume(audio);
    await audio.play().catch((e: unknown) => {
      // A live stream starts here after a pause; a refused start must not pass in silence.
      if (live() && e instanceof Error && e.name === 'NotAllowedError') {
        error = t('The browser did not let playback start. Press play again.');
      }
    });
  }
  emit();
}

export async function load(next: BookLoad, autoplay: boolean): Promise<void> {
  // Time saved so far belongs to the book that played; the next one is measured afresh.
  skipper.detach();
  if (book?.bookId !== next.bookId) {
    sound.restartLoudness();
    sound.setTagGain(element, null);
    nowPlaying = null;
  }
  clearPreparing();
  book = next;
  pausedAt = next.pausedAt;
  placeChangedAt = next.pausedAt ?? 0;
  const rewind =
    autoplay && settings.smartRewind && pausedAt !== null && !next.live
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
  if (!book || live()) return;
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
  // After a pause a live stream goes back to what is on air now, not where it stopped (M154).
  if (live() && (ended || pausedAt !== null || element.error || error)) {
    pausedAt = null;
    // Played inside the tap, so the browser lets the element play once the source is back.
    void element.play().catch(() => {});
    await setPart(index, 0, true);
    return;
  }
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
  if (live()) return;
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
  // While a receiver plays the part isn't reloaded: that would restart it there (M125). The
  // effects come on once casting ends.
  else if (audio && remoting()) leftEffects = true;
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

// The web steps through a list only in the app's list banner; ⏮/⏭ stay the skip by time (M112).
export async function setQueue(
  next: BookLoad[],
  listNext: number | null = null,
  list: QueueList | null = null,
): Promise<void> {
  void listNext;
  void list;
  queue = [...next];
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

export async function takeHistory(): Promise<HistoryItem[]> {
  const list = history;
  history = [];
  return list;
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
  skipper.detach();
  detachHls();
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
  session.setActionHandler('play', byKey('play', play));
  session.setActionHandler('pause', byKey('pause', pause));
  // ⏮ and ⏭ skip by the interval, as on Android's lock screen, also while a list plays.
  session.setActionHandler(
    'previoustrack',
    byKey('skip', () => skip(false)),
  );
  session.setActionHandler(
    'nexttrack',
    byKey('skip', () => skip(true)),
  );
  session.setActionHandler(
    'seekbackward',
    byKey('skip', () => skip(false)),
  );
  session.setActionHandler(
    'seekforward',
    byKey('skip', () => skip(true)),
  );
  // The browser's media overlay and the system's media controls can drag within the chapter (the
  // whole book without chapters) and stop.
  const optional: [MediaSessionAction, MediaSessionActionHandler][] = [
    [
      'seekto',
      (details) => {
        if (details.seekTime !== undefined) {
          const ms = Math.max(0, details.seekTime) * 1000;
          // Without the book's durations the bar is the file, and so is the seek.
          const go = () =>
            offsetOf(book?.files.length ?? 0) > 0
              ? seekToBook(shownSpanStart + ms)
              : seekTo(index, ms);
          // A drag sends many fast seeks; only the one where it lets go is kept in the history.
          if (details.fastSeek) void go();
          else byKey('seek', go)();
        }
      },
    ],
    ['stop', byKey('pause', pause)],
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
  const key = `${book.bookId} ${now.partTitle ?? ''} ${picture ?? ''} ${now.nowPlaying ?? ''}`;
  if (key !== shownMeta) {
    shownMeta = key;
    const given =
      picture ?? (book.coverUri && !book.coverUri.startsWith('file://') ? book.coverUri : null);
    // A cover kept in OPFS needs a blob URL first; it is added once that is ready.
    const kept = given?.startsWith(OPFS_SCHEME) ? given.slice(OPFS_SCHEME.length) : null;
    const cover = kept ? null : given;
    // A station shows what is on air, over its own name and “Live” (M154).
    const metadata = new MediaMetadata({
      title: now.live ? (now.nowPlaying ?? book.title) : (now.partTitle ?? book.title),
      artist: now.live ? (now.nowPlaying ? book.title : t('Live')) : (book.author ?? ''),
      album: now.live ? t('Live') : book.title,
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
  if (now.live) {
    try {
      navigator.mediaSession.setPositionState();
    } catch {
      // As below.
    }
    return;
  }
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
      // M122: what kind of file is mapped, how far, the stream's bytes skip silence shared with
      // the element and fetched itself, and the level playing now.
      kind: () => skipper.kind,
      knownUntil: (ms: number) => skipper.map?.knownUntil(ms) ?? null,
      bytes: () => ({ ...tee.teeCounts }),
      peak: () => sound.peakNow(element),
      settings: (patch: Partial<PlayerSettings>) => setSettings({ ...settings, ...patch }),
      // Plays one file as a book, for formats no catalog offers yet.
      playUrl: (uri: string, durationMs: number, startMs = 0) =>
        load(
          {
            bookId: `check:${uri}`,
            title: uri,
            author: null,
            coverUri: null,
            files: [{ uri, location: uri, title: uri, durationMs }],
            chapters: [],
            startIndex: 0,
            startPositionMs: startMs,
            speed: 1,
            pausedAt: null,
          },
          true,
        ),
    },
  });
}

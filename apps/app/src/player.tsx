import {
  carShelves,
  continueListening,
  episodeBook,
  deviceValue,
  setDeviceValue,
  finishFromPlayer,
  listUpNext,
  getBook,
  getSettings,
  resumePoint,
  saveProgress,
  stripExtension,
  toFilePosition,
  dayKey,
  listenedBetween,
  recordListening,
  localFileUri,
  trimOfBook,
  trimmedStart,
  sharedHeaders,
  isLocalAddress,
  regroupedBook,
} from '@lelap/core';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform, View } from 'react-native';

import { applyBedtime } from './bedtime';
import { coverUri } from './components/BookCover';
import { db, newId } from './db';
import { logCaught } from './diagnostics';
import * as audio from './platform/audio';
import { profileId, setProfileId } from './profile';
import { prepareAudiobookshelfBook } from './audiobookshelf';
import { askLocalNetwork } from './localNetwork';
import { fileAccess } from './remote';
import { onRootScanned } from './scan';
import { flushScrobbles, foldServiceAccounting, trackFinished, trackPlayerState } from './scrobble';
import { checkServerAfterError } from './serverCheck';
import { flushServerPlaces, serverPlacesFinished, trackServerPlaces } from './serverPlaces';

export const IDLE: audio.PlayerState = {
  connected: false,
  playing: false,
  buffering: false,
  ended: false,
  bookId: null,
  fileLocation: null,
  bookTitle: null,
  partTitle: null,
  partIndex: -1,
  partCount: 0,
  positionMs: 0,
  durationMs: 0,
  speed: 1,
  duckOnInterruption: true,
  waitingForCall: false,
  sleepTimerRemainingMs: null,
  sleepTimerMode: null,
  error: null,
};

const SAVE_INTERVAL_MS = 10_000;

type Library = {
  /** Bumped whenever stored library data may have changed; screens re-read on change. */
  version: number;
  refresh: () => void;
};

// Two contexts: the player state changes every second while playing, the library rarely, and
// the Library list should only re-render for the latter.
const PlayerStateContext = createContext<audio.PlayerState>(IDLE);
const LibraryContext = createContext<Library>({ version: 0, refresh: () => {} });

export const usePlayerState = () => useContext(PlayerStateContext);
export const useLibrary = () => useContext(LibraryContext);

// Books whose place this session has played; only those are saved when another book replaces
// them. A book only loaded at startup may sit at a fallback place (its saved file is missing),
// and saving that would stop the place from following the file when it comes back.
const playedThisSession = new Set<string>();

// Loads run one at a time, so the startup load can never land after (and undo) a user's tap.
let loads: Promise<unknown> = Promise.resolve();
let userLoaded = false;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = loads.then(task, task);
  loads = next.catch(() => {});
  return next;
}

const PLAYER_PROFILE = 'playerProfile';
const JOURNAL_WAIT_MS = 1_500;

/**
 * The profile the loaded book was loaded for. Its places go there, even after the listener has
 * switched profile, so one person's place never lands in another's.
 */
export const playerProfile = () => deviceValue(db, PLAYER_PROFILE) ?? profileId;

/** Folds the service's journal into the database, for places saved while the app was closed. */
async function foldJournal(): Promise<void> {
  // Books the service replaced by itself (Up Next, Android Auto) first: they are older.
  const earlier = await audio.takeEarlierPlaces().catch(() => []);
  for (const place of earlier) saveProgress(db, playerProfile(), place, 'journal');
  const entry = await audio.takeJournal();
  if (entry) saveProgress(db, playerProfile(), entry, 'journal');
}

/** Saves the place playing right now, before anything replaces it. */
function savePlace(state: audio.PlayerState): boolean {
  if (!state.bookId || !state.fileLocation) return false;
  return saveProgress(
    db,
    playerProfile(),
    {
      bookId: state.bookId,
      fileLocation: state.fileLocation,
      filePositionMs: state.positionMs,
      savedAt: Date.now(),
    },
    'app',
  );
}

/** Loads a book at its saved place, or resumes it when it is already loaded. */
export async function playBook(bookId: string, autoplay = true): Promise<void> {
  userLoaded = true;
  // Android 17: a book streamed from a server at home asks for local network access first. It
  // loads either way; without access the player's error says why.
  if (streamsFromLocalNetwork(bookId)) await askLocalNetwork(true);
  return enqueue(() => load(bookId, autoplay));
}

/** Whether any part of a book that is not downloaded streams from the local network. */
export function streamsFromLocalNetwork(bookId: string): boolean {
  return bookLoad(bookId)?.files.some((f) => isLocalAddress(f.uri)) ?? false;
}

/** Startup: the last book, paused, unless the user has already chosen one. */
function loadAtStartup(bookId: string): Promise<void> {
  return enqueue(async () => {
    if (!userLoaded) await load(bookId, false);
  });
}

/**
 * Loads a loaded book again, so it plays from downloaded files or, after they are removed, from
 * the stream. A playing book is only reloaded when [evenWhilePlaying] (its files are going).
 */
export function reloadBook(bookId: string, evenWhilePlaying: boolean): Promise<void> {
  return enqueue(async () => {
    const current = await audio.getState();
    if (current.bookId !== bookId || current.partIndex < 0) return;
    if (current.playing && !evenWhilePlaying) return;
    // Removed from the library (with its download): nothing is left to play.
    if (!getBook(db, profileId, bookId)) {
      await audio.unload();
      return;
    }
    await load(bookId, current.playing, true);
  });
}

/**
 * After a rescan regrouped the loaded book's files into another book, loads that book at the same
 * place, so the Player shows it instead of “Nothing is playing”.
 */
export function followRegrouped(): Promise<void> {
  return enqueue(async () => {
    const current = await audio.getState();
    if (!current.bookId || !current.fileLocation || current.partIndex < 0) return;
    if (playerProfile() !== profileId) return;
    const target = regroupedBook(db, current.bookId, current.fileLocation);
    if (target) await load(target, current.playing, true);
  });
}

/**
 * Hands the loaded book's new chapters (found from silences) to the player, also while it plays:
 * the Android service keeps the place and renames the lock screen title and moves a chapter
 * timer. The web player would start the book over, so there a playing book waits for its next load.
 */
export function updateChapters(bookId: string): Promise<void> {
  if (Platform.OS !== 'android') return reloadBook(bookId, false);
  return enqueue(async () => {
    const current = await audio.getState();
    if (current.bookId !== bookId || current.partIndex < 0) return;
    if (playerProfile() !== profileId) return;
    const book = bookLoad(bookId);
    if (book) await audio.load(book, false);
  });
}

/**
 * Sends Up Next and the car's books to the service again, after their files moved or went, so
 * nothing it starts by itself reads deleted files.
 */
export async function resendQueue(): Promise<void> {
  await syncQueue();
  if (Platform.OS === 'android') await syncCar();
}

async function load(bookId: string, autoplay: boolean, force = false): Promise<void> {
  const current = await audio.getState();
  if (playerProfile() !== profileId) {
    // A switch since this book was loaded: keep its place for its own profile, load fresh.
    if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
    playedThisSession.clear();
    force = true;
  }
  if (!force && current.bookId === bookId && current.partIndex >= 0) {
    if (autoplay) await audio.play();
    return;
  }
  if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
  // A newer place from Audiobookshelf's own player is taken first.
  await prepareAudiobookshelfBook(bookId, profileId);
  const book = bookLoad(bookId);
  if (!book) throw new Error('The files of this book are not available.');
  // What the service heard so far belongs to the profile it played for, which may change here:
  // after the service has counted up to the pause, so none of it lands in the next profile.
  if (playerProfile() !== profileId) {
    await audio.settleAccounting().catch(() => {});
    await foldServiceAccounting(playerProfile());
  }
  setDeviceValue(db, PLAYER_PROFILE, profileId, Date.now());
  await audio.load(book, autoplay);
}

/** What the player needs for a book, at its saved place; null when it has no files here. */
export function bookLoad(bookId: string): audio.BookLoad | null {
  const detail = getBook(db, profileId, bookId);
  if (!detail || detail.files.length === 0) return null;
  const start = resumePoint(db, profileId, bookId);
  if (!start) return null;
  const trim = detail.book.source === 'feed' ? trimOfBook(db, profileId, bookId) : null;
  const now = Date.now();
  const access = detail.files.map((f) => fileAccess({ ...f, bookId }, now));
  return {
    bookId,
    title: detail.book.title,
    author: detail.book.author,
    // The web's saved covers are in OPFS; the web player turns `opfs:` into a blob URL.
    coverUri:
      Platform.OS === 'web'
        ? coverUri(detail.book)
        : detail.book.coverPath
          ? localFileUri(detail.book.coverPath)
          : detail.book.coverUrl,
    files: detail.files.map((f, i) => ({
      // A downloaded part plays from the phone; the rest stream (signed, if on a server).
      uri: f.downloadPath ? localFileUri(f.downloadPath) : (access[i]?.uri ?? f.uri),
      location: f.location,
      title: f.title ?? stripExtension(f.name),
      durationMs: f.durationMs,
      name: f.name,
    })),
    chapters: detail.chapters,
    startIndex: start.index,
    // Past the intro here too, so a receiver that is cast to starts after it as well.
    startPositionMs: trimmedStart(start.index, start.positionMs, 0, trim?.skipIntroMs ?? 0),
    speed: detail.speed,
    pausedAt: detail.book.lastPlayedAt,
    handsOver: detail.book.source === 'feed',
    // A book's files all come from one place, so one login covers them; files that would get
    // different headers get none.
    headers: sharedHeaders(access),
    ...(access.some((a) => a.private) ? { privateUris: true } : {}),
    // The player skips them, also for episodes Up Next or the car starts with the app closed.
    ...trim,
  };
}

/**
 * Gives the playback service what plays after the loaded book: Up Next in order, up to and
 * including the first book (a book stops at its end, so nothing after it can follow on).
 */
async function syncQueue(): Promise<void> {
  if (playerProfile() !== profileId) return;
  const loaded = (await audio.getState()).bookId;
  const queue: audio.BookLoad[] = [];
  for (const item of listUpNext(db, profileId)) {
    if (item.bookId === loaded) continue;
    const book = bookLoad(item.bookId);
    if (!book) continue;
    queue.push(book);
    if (!book.handsOver) break;
  }
  await audio.setQueue(queue).catch(() => {});
}

/**
 * Gives the playback service the books Android Auto lists, so the car can browse and play them
 * with the app closed. Only the listener's own profile is offered.
 */
async function syncCar(): Promise<void> {
  if (playerProfile() !== profileId) return;
  const shelves = carShelves(db, profileId);
  const loads = (ids: string[]) =>
    ids.map((id) => bookLoad(id)).filter((b): b is audio.BookLoad => b !== null);
  // An episode needs its library book before it can play; it is made here, like on first play.
  const episodes = shelves.latestEpisodes.map(
    (e) => e.bookId ?? episodeBook(db, e.episodeId, Date.now(), newId),
  );
  await audio
    .setCarLibrary({
      continueListening: loads(shelves.continueListening),
      onPhone: loads(shelves.onPhone),
      podcasts: loads(episodes),
      upNext: loads(shelves.upNext),
    })
    .catch(() => {});
}

/** Marks what the service played to its end as finished, in the profile it played for. */
async function foldFinished(): Promise<boolean> {
  const done = await audio.takeFinished().catch(() => []);
  for (const item of done) {
    finishFromPlayer(db, playerProfile(), item.bookId, item.at);
    trackFinished(item.bookId, item.at, playerProfile());
    serverPlacesFinished(item.bookId, item.at, playerProfile());
  }
  return done.length > 0;
}

/**
 * Switches the listener: pauses what plays (its place stays with its profile), applies the new
 * profile's settings and loads its last book, paused, for the lock screen and mini player.
 */
export function switchProfile(id: string): Promise<void> {
  return enqueue(async () => {
    if (id === profileId) return;
    const current = await audio.getState();
    // Saved now, for the profile it belongs to: the player may be emptied below.
    if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
    if (current.playing) await audio.pause();
    setProfileId(id);
    await audio.setSettings(getSettings(db, id));
    await applyBedtime(getSettings(db, id));
    const next = continueListening(db, id);
    // The lock screen follows the listener: their last book, or nothing. A book that can't load
    // here empties the player too, so headphones can't resume the last listener's book.
    const loaded = next
      ? await load(next.id, false).then(
          () => true,
          () => false,
        )
      : false;
    if (!loaded && current.bookId) await audio.unload();
  });
}

/** Jumps to a place on the whole-book timeline. */
export async function seekToBookPosition(bookId: string, bookPositionMs: number): Promise<void> {
  const detail = getBook(db, profileId, bookId);
  if (!detail) return;
  const target = toFilePosition(detail.files, bookPositionMs);
  await audio.seekTo(target.index, target.positionMs);
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(IDLE);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const lastSave = useRef(0);
  const refreshedFor = useRef<string | null>(null);
  const wasPlaying = useRef(false);

  // Children wait for the journal, so the first screen already shows places saved while the app
  // was closed. A player that doesn't answer holds them back no longer than this.
  const [journalFolded, setJournalFolded] = useState(false);

  useEffect(() => {
    const subscription = audio.addStateListener(setState);
    const start = async () => {
      const folded = foldJournal().catch(logCaught);
      await Promise.race([folded, new Promise((resolve) => setTimeout(resolve, JOURNAL_WAIT_MS))]);
      setJournalFolded(true);
      // The startup load still waits for the journal, so it starts at the newest place.
      await folded;
      await foldServiceAccounting(playerProfile());
      await foldFinished();
      await audio.setSettings(getSettings(db, profileId));
      await applyBedtime(getSettings(db, profileId));
      const now = await audio.getState();
      setState(now);
      if (!now.bookId) {
        const next = continueListening(db, profileId);
        // Ready on the lock screen and mini player, without starting to play.
        if (next) await loadAtStartup(next.id).catch(() => {});
      }
    };
    void start()
      .catch(logCaught)
      .finally(() => {
        setJournalFolded(true);
        refresh();
      });
    void flushScrobbles();
    // Places for servers that waited while the app was closed or offline go out now.
    void flushServerPlaces(true);
    const appState = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      void foldJournal()
        .then(() => foldServiceAccounting(playerProfile()))
        .then(foldFinished)
        .catch(logCaught)
        .finally(refresh);
      void flushScrobbles();
      void flushServerPlaces(true);
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [refresh]);

  // Each root a scan brings in shows at once; a regrouped loaded book is followed.
  useEffect(
    () =>
      onRootScanned(() => {
        refresh();
        void followRegrouped().catch(logCaught).finally(refresh);
      }),
    [refresh],
  );

  // Listening time for the stats: what the position advanced since the last report, buffered and
  // written with the saves below, or as soon as another book starts. Only where the playback
  // service doesn't count it itself (the web); on Android it comes from foldServiceAccounting.
  const lastTick = useRef<{
    bookId: string;
    title: string | null;
    fileLocation: string | null;
    positionMs: number;
    at: number;
  } | null>(null);
  const listened = useRef(0);
  const flushListening = useCallback((bookId: string | null, title: string | null) => {
    if (!bookId || listened.current < 1_000) return;
    recordListening(db, playerProfile(), {
      day: dayKey(new Date()),
      bookId,
      title: title ?? '',
      ms: listened.current,
    });
    listened.current = 0;
  }, []);
  useEffect(() => {
    trackPlayerState(state, playerProfile());
    trackServerPlaces(state, playerProfile());
    checkServerAfterError(state, refresh);
  }, [state]);

  useEffect(() => {
    if (audio.countsInService) return;
    const now = Date.now();
    const before = lastTick.current;
    if (before && before.bookId !== state.bookId) flushListening(before.bookId, before.title);
    if (state.playing && state.bookId && before?.bookId === state.bookId) {
      listened.current += listenedBetween(before, { ...state, at: now });
    }
    lastTick.current =
      state.playing && state.bookId
        ? {
            bookId: state.bookId,
            title: state.bookTitle,
            fileLocation: state.fileLocation,
            positionMs: state.positionMs,
            at: now,
          }
        : null;
  }, [state, flushListening]);

  // The app's own saves, from what the player reports: every 10 s while playing and on pause.
  useEffect(() => {
    if (state.playing && state.bookId) playedThisSession.add(state.bookId);
    const paused = wasPlaying.current && !state.playing;
    wasPlaying.current = state.playing;
    const now = Date.now();
    if (!paused && !(state.playing && now - lastSave.current >= SAVE_INTERVAL_MS)) return;
    lastSave.current = now;
    if (audio.countsInService) {
      void foldServiceAccounting(playerProfile()).then((added) => {
        if (added && paused) refresh();
      });
    } else {
      flushListening(state.bookId, state.bookTitle);
    }
    const saved = savePlace(state);
    // Lists show what plays first; refresh once when a book starts, then again on pause.
    const started = state.playing && state.bookId !== refreshedFor.current;
    if (started) refreshedFor.current = state.bookId;
    if (saved && (paused || started)) refresh();
  }, [state, refresh, flushListening]);

  // The service hands over to Up Next by itself, also with the app closed. Here the app folds in
  // what finished and sends the queue again whenever the book, its end or Up Next changes.
  useEffect(() => {
    void foldFinished().then((changed) => {
      if (changed) refresh();
    });
  }, [state.ended, state.bookId, refresh]);

  useEffect(() => {
    void syncQueue();
    if (Platform.OS === 'android') void syncCar();
  }, [state.bookId, version]);

  const library = useMemo(() => ({ version, refresh }), [version, refresh]);
  return (
    <LibraryContext.Provider value={library}>
      <PlayerStateContext.Provider value={state}>
        {journalFolded ? children : <View className="flex-1 bg-night" />}
      </PlayerStateContext.Provider>
    </LibraryContext.Provider>
  );
}

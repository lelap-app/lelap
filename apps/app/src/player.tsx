import {
  continueListening,
  getBook,
  getSettings,
  resumePoint,
  saveProgress,
  stripExtension,
  toFilePosition,
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
import { AppState } from 'react-native';

import { db } from './db';
import * as audio from './platform/audio';
import { profileId } from './profile';

export const IDLE: audio.PlayerState = {
  connected: false,
  playing: false,
  buffering: false,
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

/** Folds the service's journal into the database, for places saved while the app was closed. */
async function foldJournal(): Promise<void> {
  const entry = await audio.takeJournal();
  if (entry) saveProgress(db, profileId, entry, 'journal');
}

/** Saves the place playing right now, before anything replaces it. */
function savePlace(state: audio.PlayerState): boolean {
  if (!state.bookId || !state.fileLocation) return false;
  return saveProgress(
    db,
    profileId,
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
export function playBook(bookId: string, autoplay = true): Promise<void> {
  userLoaded = true;
  return enqueue(() => load(bookId, autoplay));
}

/** Startup: the last book, paused, unless the user has already chosen one. */
function loadAtStartup(bookId: string): Promise<void> {
  return enqueue(async () => {
    if (!userLoaded) await load(bookId, false);
  });
}

async function load(bookId: string, autoplay: boolean): Promise<void> {
  const current = await audio.getState();
  if (current.bookId === bookId && current.partIndex >= 0) {
    if (autoplay) await audio.play();
    return;
  }
  if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
  const detail = getBook(db, profileId, bookId);
  if (!detail || detail.files.length === 0)
    throw new Error('The files of this book are not available.');
  const start = resumePoint(db, profileId, bookId);
  await audio.load(
    {
      bookId,
      title: detail.book.title,
      author: detail.book.author,
      coverUri: detail.book.coverPath ? `file://${detail.book.coverPath}` : null,
      files: detail.files.map((f) => ({
        uri: f.uri,
        location: f.location,
        title: f.title ?? stripExtension(f.name),
        durationMs: f.durationMs,
      })),
      chapters: detail.chapters,
      startIndex: start.index,
      startPositionMs: start.positionMs,
      speed: detail.speed,
      pausedAt: detail.book.lastPlayedAt,
    },
    autoplay,
  );
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
  const wasPlaying = useRef(false);

  useEffect(() => {
    const subscription = audio.addStateListener(setState);
    const start = async () => {
      await foldJournal();
      await audio.setSettings(getSettings(db, profileId));
      const now = await audio.getState();
      setState(now);
      if (!now.bookId) {
        const next = continueListening(db, profileId);
        // Ready on the lock screen and mini player, without starting to play.
        if (next) await loadAtStartup(next.id).catch(() => {});
      }
    };
    void start().finally(refresh);
    const appState = AppState.addEventListener('change', (status) => {
      if (status === 'active') void foldJournal().finally(refresh);
    });
    return () => {
      subscription.remove();
      appState.remove();
    };
  }, [refresh]);

  // The app's own saves, from what the player reports: every 10 s while playing and on pause.
  useEffect(() => {
    if (state.playing && state.bookId) playedThisSession.add(state.bookId);
    const paused = wasPlaying.current && !state.playing;
    wasPlaying.current = state.playing;
    const now = Date.now();
    if (!paused && !(state.playing && now - lastSave.current >= SAVE_INTERVAL_MS)) return;
    lastSave.current = now;
    if (savePlace(state) && paused) refresh();
  }, [state, refresh]);

  const library = useMemo(() => ({ version, refresh }), [version, refresh]);
  return (
    <LibraryContext.Provider value={library}>
      <PlayerStateContext.Provider value={state}>{children}</PlayerStateContext.Provider>
    </LibraryContext.Provider>
  );
}

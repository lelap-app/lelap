import {
  automaticEpisodeFiles,
  bookSound,
  carLists,
  carShelves,
  continueListening,
  episodeBook,
  deviceValue,
  setDeviceValue,
  finishFromPlayer,
  listUpNext,
  getBook,
  learnFileDuration,
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
  setOverrides,
  followedList,
  followedListItems,
  setFollowedList,
  getPlaylist,
  listPlayOrder,
  listStart,
  listUpcoming,
  listPrevious,
  listEarlier,
  playsFromStart,
  type LibraryBook,
  type ListFollow,
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
import { savedCatalogCover } from './catalogCovers';
import { coverUri } from './components/BookCover';
import { db, newId } from './db';
import { logCaught } from './diagnostics';
import { foldHistory, logged, pruneOldHistory } from './history';
import { subscribeLanguage } from './i18n';
import { pickEpisodeFile } from './episodeFiles';
import { chapterImagesRead } from './podcasting';
import * as audio from './platform/audio';
import { profileId, setProfileId } from './profile';
import { locateAddonBook, locatesFiles } from './addonLocate';
import { prepareAudiobookshelfBook } from './audiobookshelf';
import { askLocalNetwork } from './localNetwork';
import { fileAccess } from './remote';
import { onRootScanned } from './scan';
import { flushScrobbles, foldServiceAccounting, trackFinished, trackPlayerState } from './scrobble';
import { checkServerAfterError } from './serverCheck';
import { coverAtAddressInUse, watchServerAddresses } from './addresses';
import {
  flushServerPlaces,
  keepsServerPlaces,
  queueJournalPlace,
  serverPlacesFinished,
  trackServerPlaces,
} from './serverPlaces';
import { startupMark } from './startup';

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
// In the background the player reports every 10 s (M106); one that lands a moment early still saves.
const SAVE_SLACK_MS = 1_000;

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

/**
 * The list that plays (M112) with its items, what plays from it now and what comes next; null
 * when no list plays.
 */
export function useFollowedList() {
  const { version } = useLibrary();
  const { bookId } = usePlayerState();
  // `version` and the loaded book are the signals to re-read the database.
  return useMemo(() => {
    const following = followedListItems(db, profileId, Date.now());
    if (!following) return null;
    const { follow, list, items } = following;
    // The loaded book before the queue caught up with it; an Up Next item in between leaves the list's.
    const current = bookId && items.some((b) => b.id === bookId) ? bookId : follow.bookId;
    return {
      list,
      items,
      playing: current,
      next: listUpcoming(items, current, list.keepFinished)[0] ?? null,
      previous: listPrevious(items, current, list.keepFinished),
    };
  }, [version, bookId]);
}

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

/**
 * Folds the service's journal into the database, for places saved while the app was closed. A
 * place newer than the app knew goes to the book's server too (M100), unless the book plays on:
 * then the player's own reports follow. `send` false leaves sending them to the caller.
 */
export async function foldJournal(send = true): Promise<void> {
  // Books the service replaced by itself (Up Next, Android Auto) first: they are older.
  const earlier = await audio.takeEarlierPlaces().catch(() => []);
  const entry = await audio.takeJournal();
  const places = entry ? [...earlier, entry] : earlier;
  if (places.length === 0) return;
  const profile = playerProfile();
  const saved = places.filter((place) => saveProgress(db, profile, place, 'journal'));
  if (saved.length === 0) return;
  // Asking the player starts its service, so only when there is a place to send.
  const playing = await Promise.race([
    audio.getState().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), JOURNAL_WAIT_MS)),
  ]);
  for (const place of saved) {
    if (playing?.playing && playing.bookId === place.bookId) continue;
    queueJournalPlace(place, profile);
  }
  if (send) void flushServerPlaces();
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
  // A book outside the list that plays, and outside Up Next, ends following the list (M112).
  const following = followedListItems(db, profileId, Date.now());
  if (
    following &&
    !following.items.some((b) => b.id === bookId) &&
    !listUpNext(db, profileId).some((i) => i.bookId === bookId)
  ) {
    setFollowedList(db, profileId, null, Date.now());
  }
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
 * Hands the loaded book's new chapters (found from silences, or edited by hand) to the player,
 * also while it plays:
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
 * Hands the loaded episode the files its show's choice now allows (M121), when its address stays:
 * the Android service picks between them by itself later.
 */
export function updateEpisodeFiles(bookId: string): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    const book = bookLoad(bookId);
    if (book) await audio.updateBook(book);
  });
}

/** Hands the loaded episode its chapter pictures once they are read, at its live place. */
export function updateArtworks(bookId: string): Promise<void> {
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    const book = bookLoad(bookId);
    if (book?.artworks) await audio.updateBook(book);
  });
}

/**
 * Hands the loaded book its chapters again after a language switch, so untitled ones are named in
 * the new language on the lock screen, the notification and in the car, at the live place (M124).
 */
function renameChapters(): Promise<void> {
  return enqueue(async () => {
    const current = await audio.getState();
    if (!current.bookId || current.partIndex < 0) return;
    if (playerProfile() !== profileId) return;
    const book = bookLoad(current.bookId);
    if (!book) return;
    // The web player takes new names in place; a load there would start the book over.
    if (Platform.OS === 'android') await audio.load(book, false);
    else await audio.updateBook(book);
  });
}

/**
 * Hands the loaded book its own sound (M84) after it changed, at its live place. Up Next and the
 * car's books follow with the next library refresh.
 */
export function updateSound(bookId: string): Promise<void> {
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    const book = bookLoad(bookId);
    if (book) await audio.updateBook(book);
  });
}

/**
 * After a sync brought changes: the listener's sound defaults and the loaded book's own sound
 * reach the player now, not at the next load.
 */
export function applySyncedSound(): Promise<void> {
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    await audio.setSettings(getSettings(db, profileId));
    const { bookId } = await audio.getState();
    const book = bookId ? bookLoad(bookId) : null;
    if (book) await audio.updateBook(book);
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

/**
 * Plays a list (M112) and follows it: each item hands over to the next one when it ends, books
 * and episodes alike, also with the app closed. Starts at `bookId`, or where the list stands.
 * False when nothing in it is left to play.
 */
export async function playList(listId: string, bookId?: string): Promise<boolean> {
  const list = getPlaylist(db, profileId, listId);
  if (!list) return false;
  const before = followedList(db, profileId);
  // A smart list plays in the order it shows now; see `ListFollow.order`.
  const items = list.rule
    ? listPlayOrder(db, profileId, list, null)
    : listPlayOrder(db, profileId, list);
  const start = bookId
    ? items.find((b) => b.id === bookId)
    : listStart(items, list.keepFinished, before?.listId === listId ? before.bookId : null);
  if (!start) return false;
  const order = list.rule ? items.map((b) => b.id) : null;
  await playListItem({ listId, bookId: start.id, order }, start, list.keepFinished, true);
  return true;
}

/**
 * Follows `follow` and plays its item, from the start when it is finished and the list keeps
 * those. The list is followed inside the load's turn, so a queue update waiting before it never
 * sees the list with the old book still loaded; a load that fails leaves things as they were.
 */
async function playListItem(
  follow: ListFollow,
  book: LibraryBook,
  keepFinished: boolean,
  autoplay: boolean,
) {
  userLoaded = true;
  if (streamsFromLocalNetwork(book.id)) await askLocalNetwork(true);
  const fromStart = playsFromStart(book, keepFinished);
  await enqueue(async () => {
    const before = followedList(db, profileId);
    setFollowedList(db, profileId, follow, Date.now());
    try {
      await load(book.id, autoplay, fromStart, fromStart);
    } catch (error) {
      setFollowedList(db, profileId, before, Date.now());
      throw error;
    }
    // A book loaded before its list played stops at its end; now it hands over.
    const loaded = bookLoad(book.id, { fromStart });
    if (loaded) await audio.updateBook(loaded);
    // Android keeps a loaded book's live place, also when it sits at its end.
    if (loaded && fromStart) await audio.seekTo(loaded.startIndex, loaded.startPositionMs);
  });
  await syncQueue();
}

/** The player's Previous and Next in list: the item before or after the one playing. */
export async function stepList(forward: boolean): Promise<void> {
  const following = followedListItems(db, profileId, Date.now());
  if (!following) return;
  const { follow, list, items } = following;
  const target = forward
    ? listUpcoming(items, follow.bookId, list.keepFinished)[0]
    : listPrevious(items, follow.bookId, list.keepFinished);
  if (!target) return;
  const { playing } = await audio.getState();
  await playListItem({ ...follow, bookId: target.id }, target, list.keepFinished, playing);
}

/** Stops following the list: what plays now stops at its end again, like any book. */
export async function stopList(): Promise<void> {
  setFollowedList(db, profileId, null, Date.now());
  await enqueue(async () => {
    const { bookId } = await audio.getState();
    const loaded = bookId ? bookLoad(bookId) : null;
    if (loaded) await audio.updateBook(loaded);
  });
  await syncQueue();
}

async function load(
  bookId: string,
  autoplay: boolean,
  force = false,
  fromStart = false,
): Promise<void> {
  const current = await audio.getState();
  if (playerProfile() !== profileId) {
    // A switch since this book was loaded: keep its place for its own profile, load fresh.
    if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
    playedThisSession.clear();
    force = true;
  }
  if (!force && current.bookId === bookId && current.partIndex >= 0) {
    if (autoplay) await logged('play', audio.play);
    return;
  }
  if (current.bookId && playedThisSession.has(current.bookId)) savePlace(current);
  // A newer place from Audiobookshelf's own player is taken first.
  await prepareAudiobookshelfBook(bookId, profileId);
  // An add-on server says where the files are now, such as Plex away from home (M100).
  await locateAddonBook(bookId, profileId);
  // An episode streams the file its show's choice and the connection call for (M103).
  pickEpisodeFile(bookId);
  const book = bookLoad(bookId, { fromStart });
  if (!book) throw new Error('The files of this book are not available.');
  // What the service heard so far belongs to the profile it played for, which may change here:
  // after the service has counted up to the pause, so none of it lands in the next profile.
  if (playerProfile() !== profileId) {
    await audio.settleAccounting().catch(() => {});
    await foldServiceAccounting(playerProfile());
  }
  setDeviceValue(db, PLAYER_PROFILE, profileId, Date.now());
  await audio.load(book, autoplay);
  // The listener's Play from the library, for the history (M138).
  if (autoplay) await logged('play', async () => {}, undefined, bookId);
}

/**
 * What the player needs for a book, at its saved place; null when it has no files here. While a
 * list plays (`following`, by default whether one does), every item hands over to the next.
 */
export function bookLoad(
  bookId: string,
  options: { fromStart?: boolean; following?: boolean } = {},
): audio.BookLoad | null {
  const detail = getBook(db, profileId, bookId);
  if (!detail || detail.files.length === 0) return null;
  const saved = resumePoint(db, profileId, bookId);
  if (!saved) return null;
  // A finished item of a list that keeps them plays again from the top.
  const start = options.fromStart ? { index: 0, positionMs: 0 } : saved;
  const following = options.following ?? followedList(db, profileId) !== null;
  const trim = detail.book.source === 'feed' ? trimOfBook(db, profileId, bookId) : null;
  const now = Date.now();
  const access = detail.files.map((f) => fileAccess({ ...f, bookId }, now));
  // The Android service picks an automatic episode's file by itself (M121); the web is unmetered.
  const auto =
    Platform.OS === 'android' && detail.book.source === 'feed' && detail.files.length === 1
      ? automaticEpisodeFiles(db, profileId, bookId)
      : null;
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
          : (savedCatalogCover(detail.book.coverUrl, { check: true }) ??
            coverAtAddressInUse(detail.book.coverUrl)),
    files: detail.files.map((f, i) => ({
      // A downloaded part plays from the phone; the rest stream (signed, if on a server).
      uri: f.downloadPath ? localFileUri(f.downloadPath) : (access[i]?.uri ?? f.uri),
      location: f.location,
      title: f.title ?? stripExtension(f.name),
      durationMs: f.durationMs,
      name: f.name,
      ...(auto && !f.downloadPath && (f.uri === auto.unmetered || f.uri === auto.metered)
        ? { auto }
        : {}),
    })),
    chapters: detail.chapters,
    startIndex: start.index,
    // Past the intro here too, so a receiver that is cast to starts after it as well.
    startPositionMs: trimmedStart(start.index, start.positionMs, 0, trim?.skipIntroMs ?? 0),
    speed: detail.speed,
    pausedAt: detail.book.lastPlayedAt,
    handsOver: detail.book.source === 'feed' || following,
    // A book's files all come from one place, so one login covers them; files that would get
    // different headers get none.
    headers: sharedHeaders(access),
    ...(access.some((a) => a.private) ? { privateUris: true } : {}),
    // The player skips them, also for episodes Up Next or the car starts with the app closed.
    ...trim,
    // The book's or show's own sound (M84), for the same reason.
    sound: setOverrides(bookSound(db, profileId, bookId).overrides),
    ...(detail.book.source === 'feed' ? artworksOf(bookId) : {}),
    ...serverTasksOf(detail.files),
  };
}

/** What the service asks the app for with this book, also when it is closed (M123). */
function serverTasksOf(
  files: { rootId: string | null; downloadPath?: string | null }[],
): Pick<audio.BookLoad, 'serverPlaces' | 'locate'> {
  if (Platform.OS !== 'android') return {};
  return {
    ...(keepsServerPlaces(files, profileId) ? { serverPlaces: true } : {}),
    ...(locatesFiles(files) ? { locate: true } : {}),
  };
}

/**
 * A book the service started by itself from an add-on server that locates its files (Up Next,
 * Android Auto, the widget): the add-on says where they are now, and the service moves the book
 * there at its live place (M123). Runs as a server task, also with the app closed.
 */
export function relocateBook(bookId: string): Promise<void> {
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    await locateAddonBook(bookId, profileId);
    if ((await audio.getState()).bookId !== bookId) return;
    const book = bookLoad(bookId);
    // Only for the book still loaded; files at the same addresses change nothing.
    if (book) await audio.updateBook(book);
  });
}

/**
 * The loaded book's server answers at its other address now (M146), such as away from home Wi-Fi:
 * the book plays on from there at its live place. Downloaded parts and other books stay as they are.
 */
function followServerAddress(rootIds: Set<string>): Promise<void> {
  return enqueue(async () => {
    if (playerProfile() !== profileId) return;
    const bookId = (await audio.getState()).bookId;
    if (!bookId) return;
    const files = getBook(db, profileId, bookId)?.files ?? [];
    if (!files.some((f) => f.rootId !== null && rootIds.has(f.rootId) && !f.downloadPath)) return;
    const book = bookLoad(bookId);
    if (book) await audio.updateBook(book);
  });
}

/**
 * An episode's chapter pictures for the lock screen and the car (M103) and the browser's media
 * controls (M121), when read already.
 */
function artworksOf(bookId: string): Pick<audio.BookLoad, 'artworks'> {
  const images = chapterImagesRead(bookId);
  return images.length > 0
    ? { artworks: images.map((i) => ({ startMs: i.startMs, uri: i.img })) }
    : {};
}

// Enough for a long drive with the app closed; the app sends the queue again on every change.
const QUEUE_LIMIT = 25;
// Previous in list away from the phone (M119): a few steps back, until the app sends more.
const BEFORE_LIMIT = 5;

// The book last told to hand over while a list plays, so that is sent once per book.
let lastHandedOver: string | null = null;
// The provider's refresh, so screens see the list followed or left by a queue update.
let onFollowChange: () => void = () => {};

/**
 * Gives the playback service what plays after the loaded book: Up Next in order, up to and
 * including the first book (a book stops at its end, so nothing after it can follow on). While a
 * list plays, everything hands over, and the rest of the list follows Up Next (M112).
 * After loads, so a list that just started is never mistaken for one the listener left.
 */
function syncQueue(): Promise<void> {
  return enqueue(sendQueue);
}

async function sendQueue(): Promise<void> {
  if (playerProfile() !== profileId) return;
  const loaded = (await audio.getState()).bookId;
  const upNext = listUpNext(db, profileId).map((i) => i.bookId);
  const now = Date.now();
  // A list picked in Android Auto (M119): the service plays along it; the app follows it too.
  // The service may have moved along the list since, so any of its items may be playing now.
  const started = await audio.takeListStarted().catch(() => null);
  const startedList = started ? getPlaylist(db, profileId, started.listId) : null;
  if (started && startedList && loaded) {
    const items = listPlayOrder(db, profileId, startedList, started);
    if (items.some((b) => b.id === loaded)) {
      setFollowedList(db, profileId, { ...started, bookId: loaded }, now);
      lastHandedOver = loaded;
      onFollowChange();
    }
  }
  let following = followedListItems(db, profileId, now);
  if (following && loaded) {
    const { follow, items } = following;
    const inList = items.some((b) => b.id === loaded);
    if (inList || upNext.includes(loaded)) {
      // The service moved along the list by itself, perhaps with the app closed.
      if (inList && follow.bookId !== loaded) {
        following = { ...following, follow: { ...follow, bookId: loaded } };
        setFollowedList(db, profileId, following.follow, now);
        onFollowChange();
      }
      // One picked in the car came without the list's hand-over.
      if (loaded !== lastHandedOver) {
        const book = bookLoad(loaded, { following: true });
        if (book) await audio.updateBook(book).catch(() => {});
        lastHandedOver = loaded;
      }
    } else {
      // Something else plays now (picked in the car): the list is left, and that stops at its end.
      setFollowedList(db, profileId, null, now);
      following = null;
      onFollowChange();
      const book = bookLoad(loaded, { following: false });
      if (book) await audio.updateBook(book).catch(() => {});
    }
  }
  if (!following) lastHandedOver = null;
  const queue: audio.BookLoad[] = [];
  const queued = new Set<string>(loaded ? [loaded] : []);
  const add = (bookId: string, fromStart = false): boolean => {
    if (queued.has(bookId) || queue.length >= QUEUE_LIMIT) return true;
    const book = bookLoad(bookId, { fromStart, following: following !== null });
    if (!book) return true;
    queued.add(bookId);
    queue.push(book);
    return book.handsOver ?? false;
  };
  for (const bookId of upNext) if (!add(bookId)) break;
  let listNext: number | null = null;
  let list: audio.QueueList | null = null;
  if (following) {
    const { follow, list: playlist, items } = following;
    const keep = playlist.keepFinished;
    for (const book of listUpcoming(items, follow.bookId, keep)) {
      const at = queue.length;
      add(book.id, playsFromStart(book, keep));
      if (listNext === null && queue.length > at) listNext = at;
    }
    // The list's own item playing, with what comes before it, for Previous in list (M119).
    const at = loaded && items.some((b) => b.id === loaded) ? loaded : null;
    // While Up Next plays in between: what lies before the list's next item, for once it starts.
    const from = at ?? listUpcoming(items, follow.bookId, keep)[0]?.id;
    const before = from
      ? listEarlier(items, from, keep)
          .slice(0, BEFORE_LIMIT)
          .map((b) => bookLoad(b.id, { fromStart: playsFromStart(b, keep), following: true }))
          .filter((b): b is audio.BookLoad => b !== null)
      : [];
    list = { id: playlist.id, title: playlist.name, at, before, keepsFinished: keep };
  }
  await audio.setQueue(queue, listNext, list).catch(() => {});
}

/**
 * Gives the playback service the books Android Auto lists, so the car can browse and play them
 * with the app closed. Only the listener's own profile is offered.
 */
async function syncCar(): Promise<void> {
  if (playerProfile() !== profileId) return;
  const shelves = carShelves(db, profileId);
  // A book often sits on several shelves and lists; each is read once.
  const read = new Map<string, audio.BookLoad | null>();
  const once = (id: string, options: { fromStart?: boolean; following: boolean }) => {
    const key = `${id}:${options.fromStart ? 1 : 0}:${options.following ? 1 : 0}`;
    if (!read.has(key)) read.set(key, bookLoad(id, options));
    return read.get(key) ?? null;
  };
  // A book picked in the car plays on its own, as in the app outside a list.
  const loads = (ids: string[]) =>
    ids.map((id) => once(id, { following: false })).filter((b): b is audio.BookLoad => b !== null);
  // A list's items hand over to the next one, as when it plays in the app (M119).
  const lists = carLists(db, profileId).map((list) => ({
    id: list.id,
    title: list.name,
    keepsFinished: list.keepFinished,
    order: list.order,
    start: list.start,
    items: list.items
      .map((item) => once(item.bookId, { fromStart: item.fromStart, following: true }))
      .filter((b): b is audio.BookLoad => b !== null),
  }));
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
      lists,
    })
    .catch(() => {});
}

/** Marks what the service played to its end as finished, in the profile it played for. */
async function foldFinished(): Promise<boolean> {
  const done = await audio.takeFinished().catch(() => []);
  for (const item of done) {
    finishFromPlayer(db, playerProfile(), item.bookId, item.at);
    trackFinished(
      item.bookId,
      item.at,
      playerProfile(),
      typeof item.startLocation === 'string' && typeof item.startPositionMs === 'number'
        ? { location: item.startLocation, positionMs: item.startPositionMs }
        : undefined,
    );
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
    // The last listener's sleep timer, routine volume and where their timer stopped are theirs.
    await audio.cancelSleepTimer().catch(() => {});
    await applyBedtime(getSettings(db, id));
    // What the last listener did away from the app is theirs.
    await foldHistory(playerProfile());
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

/**
 * Jumps to a place on the whole-book timeline at the listener's tap, logged in the history as a
 * seek or a chapter jump (M138).
 */
export async function seekToBookPosition(
  bookId: string,
  bookPositionMs: number,
  action: 'seek' | 'chapter' = 'seek',
): Promise<void> {
  const detail = getBook(db, profileId, bookId);
  if (!detail) return;
  const target = toFilePosition(detail.files, bookPositionMs);
  await logged(
    action,
    () => audio.seekTo(target.index, target.positionMs),
    () => Math.max(0, bookPositionMs),
    bookId,
  );
}

/** Plays a book from a place on its timeline: a bookmark in another book, or a shared place (M85). */
export async function playAt(bookId: string, bookPositionMs: number): Promise<void> {
  await playBook(bookId, false);
  await seekToBookPosition(bookId, bookPositionMs);
  await logged('play', audio.play, undefined, bookId);
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
    watchServerAddresses((moved) => void followServerAddress(moved).catch(logCaught));
    const start = async () => {
      const folded = foldJournal().catch(logCaught);
      await Promise.race([folded, new Promise((resolve) => setTimeout(resolve, JOURNAL_WAIT_MS))]);
      startupMark('journal-folded');
      setJournalFolded(true);
      // The startup load still waits for the journal, so it starts at the newest place.
      await folded;
      await foldServiceAccounting(playerProfile());
      await foldFinished();
      pruneOldHistory();
      await foldHistory(playerProfile());
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
        .then(() => foldHistory(playerProfile()))
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
  // What the player kept away from the app shows in the history as it happens (M138); on Android
  // the service hands it over from its preferences, so a look per update is cheap.
  useEffect(() => {
    if (state.bookId) void foldHistory(playerProfile());
  }, [state]);

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
    if (!paused && !(state.playing && now - lastSave.current >= SAVE_INTERVAL_MS - SAVE_SLACK_MS))
      return;
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

  // A file stored without a length, such as a stream its add-on gave none for, takes the one the
  // player measured, so the bar and the book's timeline have one (M140).
  useEffect(() => {
    if (!state.fileLocation || !(state.durationMs > 0)) return;
    if (learnFileDuration(db, state.fileLocation, state.durationMs)) refresh();
  }, [state.fileLocation, state.durationMs, refresh]);

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

  // A new language names untitled chapters anew: the loaded book's now, and with the refresh the
  // books in Up Next and the car's shelves, which the service holds with their names.
  useEffect(
    () =>
      subscribeLanguage(() => {
        void renameChapters().catch(logCaught);
        refresh();
      }),
    [refresh],
  );

  useEffect(() => {
    onFollowChange = refresh;
    return () => {
      onFollowChange = () => {};
    };
  }, [refresh]);

  const library = useMemo(() => ({ version, refresh }), [version, refresh]);
  return (
    <LibraryContext.Provider value={library}>
      <PlayerStateContext.Provider value={state}>
        {journalFolded ? children : <View className="flex-1 bg-night" />}
      </PlayerStateContext.Provider>
    </LibraryContext.Provider>
  );
}

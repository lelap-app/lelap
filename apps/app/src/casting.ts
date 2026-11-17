import * as local from '@lelap/audio';
import type { BookLoad, PlayerSettings, PlayerState } from '@lelap/audio';
import * as cast from '@lelap/cast';
import type { CastDevice, CastMedia, CastStatus } from '@lelap/cast';
import type { EventSubscription } from 'expo';
import { useSyncExternalStore } from 'react';

// Casting on Android (M26). While a session runs, the player's controls go to the receiver and
// the phone's own player stays paused. It is moved to the receiver's place every few seconds,
// so the service's journal keeps the place even if the app is closed, and handing back resumes
// from there. `platform/audio.ts` routes the player API through here.

export type { CastDevice };

export const CASTING_SUPPORTED = true;
export const startDiscovery = cast.startDiscovery;
export const stopDiscovery = cast.stopDiscovery;
export const listDevices = cast.devices;
export const addDevicesListener = cast.addDevicesListener;

const SYNC_EVERY_MS = 10_000;

type Session = {
  device: CastDevice;
  book: BookLoad;
  /** The file the receiver plays; receivers play one file at a time. */
  index: number;
  speed: number;
  status: CastStatus | null;
  /** A file ended and the next is being loaded; the receiver may say "ended" more than once. */
  advancing: boolean;
  lastSync: number;
};

let session: Session | null = null;
let lastError: string | null = null;
let localState: PlayerState | null = null;
let skipIntervalMs = 30_000;
const stateListeners = new Set<(state: PlayerState) => void>();
const sessionListeners = new Set<() => void>();
let localSubscription: EventSubscription | null = null;

export type Casting = { device: CastDevice | null; volume: number | null; error: string | null };
let snapshot: Casting = { device: null, volume: null, error: null };

function notify() {
  const next = {
    device: session?.device ?? null,
    volume: session?.status?.volume ?? null,
    error: lastError,
  };
  if (
    next.device?.id === snapshot.device?.id &&
    next.volume === snapshot.volume &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  for (const listener of sessionListeners) listener();
}

/** The receiver playing now, its volume, and why the last session ended, if it failed. */
export function useCasting(): Casting {
  return useSyncExternalStore(
    (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    () => snapshot,
  );
}

function emit(state: PlayerState) {
  for (const listener of stateListeners) listener(state);
}

function castState(s: Session): PlayerState {
  const file = s.book.files[s.index];
  const st = s.status;
  const base = localState ?? {
    connected: true,
    duckOnInterruption: true,
    sleepTimerRemainingMs: null,
    sleepTimerMode: null,
  };
  return {
    ...base,
    connected: true,
    // Pressing Play shows Pause straight away, also while the receiver is still buffering.
    playing: st === null || st.state === 'playing' || st.state === 'buffering',
    buffering: st === null || st.state === 'buffering',
    ended: false,
    bookId: s.book.bookId,
    fileLocation: file?.location ?? null,
    bookTitle: s.book.title,
    partTitle: file?.title ?? null,
    partIndex: s.index,
    partCount: s.book.files.length,
    positionMs: st?.positionMs ?? 0,
    durationMs: st?.durationMs || file?.durationMs || 0,
    // UPnP renderers play at 1×, whatever the book is set to.
    speed: s.device.kind === 'upnp' ? 1 : s.speed,
    waitingForCall: false,
    error: st?.error ?? null,
  };
}

function media(book: BookLoad, index: number): CastMedia {
  const file = book.files[index];
  if (!file) throw new Error('This part of the book is missing.');
  return {
    uri: file.uri,
    title: book.files.length > 1 ? file.title : book.title,
    artist: book.author,
    album: book.title,
    coverUri: book.coverUri,
    durationMs: file.durationMs,
    ...(book.headers ? { headers: book.headers } : {}),
  };
}

/** Where a skip of [deltaMs] lands, across file starts and ends like the phone's player. */
export function skipTarget(
  files: { durationMs: number }[],
  index: number,
  positionMs: number,
  deltaMs: number,
): { index: number; positionMs: number } {
  let i = index;
  let pos = positionMs + deltaMs;
  while (pos < 0 && i > 0) {
    i -= 1;
    pos += files[i]?.durationMs ?? 0;
  }
  while (i < files.length - 1 && pos >= (files[i]?.durationMs ?? Infinity)) {
    pos -= files[i]?.durationMs ?? 0;
    i += 1;
  }
  const last = files[i]?.durationMs ?? 0;
  return { index: i, positionMs: Math.max(0, last > 0 ? Math.min(pos, last - 1_000) : pos) };
}

/** Moves the paused phone player to the receiver's place, which writes the service's journal. */
function syncLocal(s: Session, force = false) {
  const now = Date.now();
  if (!force && now - s.lastSync < SYNC_EVERY_MS) return;
  s.lastSync = now;
  void local.seekTo(s.index, s.status?.positionMs ?? 0).catch(() => {});
}

async function loadPart(s: Session, index: number, positionMs: number, autoplay: boolean) {
  s.index = index;
  s.status = {
    deviceId: s.device.id,
    state: autoplay ? 'buffering' : 'paused',
    positionMs,
    durationMs: s.book.files[index]?.durationMs ?? 0,
    volume: s.status?.volume ?? null,
    error: null,
  };
  emit(castState(s));
  await cast.load(media(s.book, index), positionMs, autoplay, s.speed);
  syncLocal(s, true);
}

/** The receiver played the last file to its end: the phone takes over, paused at the end. */
async function finishBook(s: Session) {
  session = null;
  notify();
  await cast.disconnect().catch(() => null);
  const file = s.book.files[s.index];
  await local.seekTo(s.index, Math.max(0, (file?.durationMs ?? 0) - 1_000)).catch(() => {});
  emit(await local.getState());
}

function onStatus(status: CastStatus) {
  const s = session;
  if (!s || status.deviceId !== s.device.id) return;
  if (status.state === 'lost') {
    session = null;
    lastError = status.error;
    notify();
    void local
      .seekTo(s.index, status.positionMs)
      .catch(() => {})
      .then(() => local.getState())
      .then(emit);
    return;
  }
  const before = s.status?.state;
  s.status = status;
  notify();
  if (status.state === 'ended') {
    if (s.advancing) return;
    s.advancing = true;
    const next = s.index + 1;
    if (next < s.book.files.length) {
      void loadPart(s, next, 0, true)
        .catch((e: unknown) => {
          lastError = e instanceof Error ? e.message : String(e);
          notify();
        })
        .finally(() => {
          s.advancing = false;
        });
    } else {
      void finishBook(s);
    }
    return;
  }
  if (status.state === 'playing') syncLocal(s);
  else if (status.state === 'paused' && before !== 'paused') syncLocal(s, true);
  emit(castState(s));
}

cast.addStatusListener(onStatus);

function ensureLocalListener() {
  if (localSubscription) return;
  localSubscription = local.addStateListener((state) => {
    localState = state;
    if (!session) {
      emit(state);
      return;
    }
    // Play on the lock screen or headphones while casting: the phone takes the book back.
    if (state.playing) {
      session = null;
      notify();
      void cast.disconnect().catch(() => null);
      emit(state);
    }
  });
}

/** Starts the loaded book on [device], from where the phone is. */
export async function startCasting(device: CastDevice, book: BookLoad): Promise<void> {
  if (session) await stopCasting();
  ensureLocalListener();
  const st = await local.getState();
  localState = st;
  const sameBook = st.bookId === book.bookId && st.partIndex >= 0;
  const index = sameBook ? st.partIndex : book.startIndex;
  const position = sameBook ? st.positionMs : book.startPositionMs;
  if (st.playing) await local.pause();
  lastError = null;
  const s: Session = {
    device,
    book,
    index,
    speed: st.speed,
    status: null,
    advancing: false,
    lastSync: 0,
  };
  session = s;
  notify();
  emit(castState(s));
  try {
    await cast.connect(device.id);
    await loadPart(s, index, position, true);
  } catch (e) {
    if (session === s) session = null;
    lastError = e instanceof Error ? e.message : String(e);
    notify();
    await cast.disconnect().catch(() => null);
    emit(await local.getState());
    throw e;
  }
}

/** Hands the book back to the phone at the receiver's place; it plays on if it was playing. */
export async function stopCasting(): Promise<void> {
  const s = session;
  if (!s) return;
  const wasPlaying = s.status?.state === 'playing' || s.status?.state === 'buffering';
  session = null;
  notify();
  const position = (await cast.disconnect().catch(() => null)) ?? s.status?.positionMs ?? 0;
  await local.seekTo(s.index, position);
  if (wasPlaying) await local.play();
  emit(await local.getState());
}

export function setCastVolume(level: number): Promise<void> {
  if (session?.status) session.status = { ...session.status, volume: level };
  notify();
  return cast.setVolume(level);
}

// The player API, routed to the receiver while casting.

export async function play(): Promise<void> {
  const s = session;
  if (!s) return local.play();
  // After the last status said the file ended or stopped, Play starts the file again.
  if (s.status?.state === 'idle') return loadPart(s, s.index, s.status.positionMs, true);
  await cast.play();
}

export async function pause(): Promise<void> {
  if (!session) return local.pause();
  await cast.pause();
}

export async function seekTo(index: number, positionMs: number): Promise<void> {
  const s = session;
  if (!s) return local.seekTo(index, positionMs);
  if (index === s.index) {
    await cast.seek(positionMs);
    if (s.status) s.status = { ...s.status, positionMs };
    syncLocal(s, true);
    emit(castState(s));
    return;
  }
  const playing = s.status?.state !== 'paused';
  await loadPart(s, index, positionMs, playing);
}

export async function seekBy(deltaMs: number): Promise<void> {
  const s = session;
  if (!s) return local.seekBy(deltaMs);
  await seekTo(s.index, Math.max(0, (s.status?.positionMs ?? 0) + deltaMs));
}

export async function skip(forward: boolean): Promise<void> {
  const s = session;
  if (!s) return local.skip(forward);
  const target = skipTarget(
    s.book.files,
    s.index,
    s.status?.positionMs ?? 0,
    forward ? skipIntervalMs : -skipIntervalMs,
  );
  await seekTo(target.index, target.positionMs);
}

export async function skipToPart(index: number): Promise<void> {
  if (!session) return local.skipToPart(index);
  await seekTo(index, 0);
}

export async function setSpeed(speed: number): Promise<void> {
  await local.setSpeed(speed);
  const s = session;
  if (!s) return;
  s.speed = speed;
  if (s.device.kind !== 'upnp') await cast.setSpeed(speed);
  emit(castState(s));
}

export function setSettings(settings: PlayerSettings): Promise<void> {
  skipIntervalMs = settings.skipIntervalMs;
  return local.setSettings(settings);
}

export async function load(book: BookLoad, autoplay: boolean): Promise<void> {
  const s = session;
  // The phone gets the book too, paused, so its journal and the hand-back follow along.
  await local.load(book, s ? false : autoplay);
  if (!s) return;
  s.book = book;
  await loadPart(s, book.startIndex, book.startPositionMs, autoplay);
}

export async function unload(): Promise<void> {
  if (session) {
    session = null;
    notify();
    await cast.disconnect().catch(() => null);
  }
  await local.unload();
}

export async function getState(): Promise<PlayerState> {
  return session ? castState(session) : local.getState();
}

export function addStateListener(listener: (state: PlayerState) => void): EventSubscription {
  ensureLocalListener();
  stateListeners.add(listener);
  return { remove: () => stateListeners.delete(listener) };
}

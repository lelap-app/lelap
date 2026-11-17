import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** A book for the player. The service keeps it to resume with the app closed. */
export type BookLoad = {
  bookId: string;
  title: string;
  author: string | null;
  coverUri: string | null;
  /** In play order. `location` identifies the file in the library. */
  files: { uri: string; location: string; title: string; durationMs: number }[];
  /** On the whole-book timeline. */
  chapters: { title: string; startMs: number }[];
  startIndex: number;
  startPositionMs: number;
  speed: number;
  /** When the place was saved, so the first Play can rewind a little. */
  pausedAt: number | null;
  /** At its end, play the next item in Up Next (podcast episodes); books stop at their end. */
  handsOver?: boolean;
  /** Sent with every request for this book's files: the login of a WebDAV server. */
  headers?: Record<string, string>;
};

/** A book or episode that played to its end, possibly with the app closed. */
export type FinishedItem = { bookId: string; at: number };

/** Player settings that must also work with the app closed. */
export type PlayerSettings = {
  duckOnInterruption: boolean;
  skipIntervalMs: number;
  smartRewind: boolean;
};

/** The service's last saved place. Same shape as `JournalEntry` in `@lelap/core`. */
export type JournalEntry = {
  bookId: string;
  fileLocation: string;
  filePositionMs: number;
  savedAt: number;
};

export type PlayerState = {
  connected: boolean;
  playing: boolean;
  buffering: boolean;
  /** The last part played to its end. */
  ended: boolean;
  bookId: string | null;
  /** Location of the file playing now. */
  fileLocation: string | null;
  bookTitle: string | null;
  partTitle: string | null;
  /** -1 when nothing is loaded. */
  partIndex: number;
  partCount: number;
  positionMs: number;
  /** 0 when unknown. */
  durationMs: number;
  speed: number;
  duckOnInterruption: boolean;
  /** Play was pressed during a call; playback starts when the call ends. */
  waitingForCall: boolean;
  sleepTimerRemainingMs: number | null;
  error: string | null;
};

type LelapAudioEvents = {
  onStateChange: (state: PlayerState) => void;
};

declare class LelapAudioModule extends NativeModule<LelapAudioEvents> {
  load(bookJson: string, autoplay: boolean): Promise<void>;
  seekTo(index: number, positionMs: number): Promise<void>;
  takeJournal(): Promise<JournalEntry | null>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekBy(deltaMs: number): Promise<void>;
  skipToPart(index: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  setSettings(duck: boolean, skipIntervalMs: number, smartRewind: boolean): Promise<void>;
  skip(forward: boolean): Promise<void>;
  startSleepTimer(minutes: number): Promise<void>;
  cancelSleepTimer(): Promise<void>;
  unload(): Promise<void>;
  setQueue(queueJson: string): Promise<void>;
  takeFinished(): Promise<FinishedItem[]>;
  getState(): Promise<PlayerState>;
}

const native = requireNativeModule<LelapAudioModule>('LelapAudio');

export function load(book: BookLoad, autoplay: boolean): Promise<void> {
  return native.load(JSON.stringify(book), autoplay);
}

export function seekTo(index: number, positionMs: number): Promise<void> {
  return native.seekTo(index, positionMs);
}

/** The service's last saved place, also when it played while the app was closed. */
export function takeJournal(): Promise<JournalEntry | null> {
  return native.takeJournal();
}

export function play(): Promise<void> {
  return native.play();
}

export function pause(): Promise<void> {
  return native.pause();
}

export function seekBy(deltaMs: number): Promise<void> {
  return native.seekBy(deltaMs);
}

export function skipToPart(index: number): Promise<void> {
  return native.skipToPart(index);
}

export function setSpeed(speed: number): Promise<void> {
  return native.setSpeed(speed);
}

export function setSettings(settings: PlayerSettings): Promise<void> {
  return native.setSettings(
    settings.duckOnInterruption,
    settings.skipIntervalMs,
    settings.smartRewind,
  );
}

/** Skips by the skip interval across files, like ⏮/⏭ on the lock screen. */
export function skip(forward: boolean): Promise<void> {
  return native.skip(forward);
}

export function startSleepTimer(minutes: number): Promise<void> {
  return native.startSleepTimer(minutes);
}

export function cancelSleepTimer(): Promise<void> {
  return native.cancelSleepTimer();
}

/** What plays after the current book when it hands over (Up Next, in order). */
export function setQueue(queue: BookLoad[]): Promise<void> {
  return native.setQueue(JSON.stringify(queue));
}

/** Books that ended since the last call, for the app to mark finished. */
export function takeFinished(): Promise<FinishedItem[]> {
  return native.takeFinished();
}

/** Empties the player: no book on the lock screen or in the notification. */
export function unload(): Promise<void> {
  return native.unload();
}

export function getState(): Promise<PlayerState> {
  return native.getState();
}

export function addStateListener(listener: (state: PlayerState) => void): EventSubscription {
  return native.addListener('onStateChange', listener);
}

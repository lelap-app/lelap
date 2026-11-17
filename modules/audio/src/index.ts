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
  /** A podcast's intro and outro to skip (M45): from the first file's start, the last's end. */
  skipIntroMs?: number;
  skipOutroMs?: number;
};

/** A book or episode that played to its end, possibly with the app closed. */
export type FinishedItem = { bookId: string; at: number };

/** Player settings that must also work with the app closed. */
export type PlayerSettings = {
  duckOnInterruption: boolean;
  skipIntervalMs: number;
  smartRewind: boolean;
  /** Both channels mixed into one, for one earbud or one good ear. */
  mono: boolean;
  /** Rumble cut below 80 Hz and a gentle lift around 3 kHz, where consonants are. */
  voiceEq: boolean;
  /** +6 dB with a limiter, so loud parts never clip. */
  volumeBoost: boolean;
};

/** The service's last saved place. Same shape as `JournalEntry` in `@lelap/core`. */
export type JournalEntry = {
  bookId: string;
  fileLocation: string;
  filePositionMs: number;
  savedAt: number;
};

/**
 * What the playback service heard (M51), also with the app closed: listening time per book and
 * local day, and scrobble session events at a file place. `seq` grows by one per record within an
 * `epoch`. Same shape as `ServiceAccounting` in `@lelap/core`.
 */
export type ServiceAccounting = {
  epoch: string;
  records: (
    | { seq: number; kind: 'listen'; bookId: string; title: string; day: string; ms: number }
    | {
        seq: number;
        kind: 'start' | 'progress' | 'pause';
        bookId: string;
        at: number;
        fileLocation: string;
        filePositionMs: number;
        startLocation: string | null;
        startPositionMs: number | null;
      }
  )[];
};

/** Minutes, or the end of the chapter playing, or of the episode (or book). */
export type SleepTimerMode = 'minutes' | 'chapter' | 'episode';

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
  /** What the running timer counts down to; null without a timer. */
  sleepTimerMode: SleepTimerMode | null;
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
  setSettings(
    duck: boolean,
    skipIntervalMs: number,
    smartRewind: boolean,
    mono: boolean,
    voiceEq: boolean,
    volumeBoost: boolean,
  ): Promise<void>;
  skip(forward: boolean): Promise<void>;
  startSleepTimer(minutes: number): Promise<void>;
  startSleepTimerAtEnd(mode: 'chapter' | 'episode'): Promise<void>;
  cancelSleepTimer(): Promise<void>;
  unload(): Promise<void>;
  castTo(): Promise<void>;
  stopCasting(resume: boolean | null): Promise<void>;
  setQueue(queueJson: string): Promise<void>;
  takeFinished(): Promise<FinishedItem[]>;
  takeEarlierPlaces(): Promise<JournalEntry[]>;
  takeAccounting(): Promise<ServiceAccounting>;
  ackAccounting(epoch: string, through: number): Promise<void>;
  settleAccounting(): Promise<void>;
  setCarLibrary(json: string): Promise<void>;
  setBedtime(json: string | null): Promise<void>;
  setDiagnostics(on: boolean): Promise<void>;
  takeDiagnostics(): Promise<PlayerDiagnostic[]>;
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
    settings.mono,
    settings.voiceEq,
    settings.volumeBoost,
  );
}

/** Skips by the skip interval across files, like ⏮/⏭ on the lock screen. */
export function skip(forward: boolean): Promise<void> {
  return native.skip(forward);
}

export function startSleepTimer(minutes: number): Promise<void> {
  return native.startSleepTimer(minutes);
}

/**
 * Stops at the end of the chapter playing (the file's, without chapters) or of the episode. A
 * seek into another chapter moves the end to that chapter's.
 */
export function startSleepTimerAtEnd(mode: 'chapter' | 'episode'): Promise<void> {
  return native.startSleepTimerAtEnd(mode);
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

/** Places of books the service replaced by itself (Up Next, Android Auto), oldest first. */
export function takeEarlierPlaces(): Promise<JournalEntry[]> {
  return native.takeEarlierPlaces();
}

/**
 * Listening time and scrobble sessions are counted in the playback service, not by the app, so
 * time heard with the app open or closed is counted once.
 */
export const countsInService = true;

/**
 * What the service heard and the app has not acknowledged. Records it returns stay as they are,
 * so merging them, remembering the highest `seq` and then calling `ackAccounting` merges each once.
 */
export function takeAccounting(): Promise<ServiceAccounting> {
  return native.takeAccounting();
}

/**
 * Has the service count what it heard up to now, after the commands sent before this one (a
 * pause), so a fold right after it is complete.
 */
export function settleAccounting(): Promise<void> {
  return native.settleAccounting();
}

/** Drops the records up to `through`, once the app has merged them. */
export function ackAccounting(epoch: string, through: number): Promise<void> {
  return native.ackAccounting(epoch, through);
}

/** The books Android Auto can browse, as the app last saw them. */
export type CarLibrary = {
  continueListening: BookLoad[];
  onPhone: BookLoad[];
  podcasts: BookLoad[];
  upNext: BookLoad[];
};

/** Hands the service what Android Auto lists, so it can answer with the app closed. */
export function setCarLibrary(library: CarLibrary): Promise<void> {
  return native.setCarLibrary(JSON.stringify(library));
}

/**
 * "Start a sleep timer at bedtime": when playback starts inside the window (minutes after local
 * midnight; it may cross midnight), the service starts a timer by itself, once per night.
 */
export type Bedtime = {
  startMinute: number;
  endMinute: number;
  /** To the end of the chapter instead of `minutes`. */
  chapter: boolean;
  minutes: number;
};

/** Hands the service the bedtime window; null turns it off. Works with the app closed. */
export function setBedtime(bedtime: Bedtime | null): Promise<void> {
  return native.setBedtime(bedtime ? JSON.stringify(bedtime) : null);
}

/**
 * A player event for the diagnostics log (M47): a word, numbers and the book's ID, never a
 * title, file or address. `code` is Media3's error code or play-when-ready reason.
 */
export type PlayerDiagnostic = {
  at: number;
  what: string;
  code: number | null;
  status: number | null;
  bookId: string | null;
  part: number | null;
};

/** Lets the service log player events, also with the app closed. Off drops what it kept. */
export function setDiagnostics(on: boolean): Promise<void> {
  return native.setDiagnostics(on);
}

/** The service's player events since the last call, oldest first. */
export function takeDiagnostics(): Promise<PlayerDiagnostic[]> {
  return native.takeDiagnostics();
}

/**
 * Plays the loaded book on the receiver `@lelap/cast` connected, from the place here. The
 * notification, lock screen and headphones then control the receiver. Resolves once the first
 * file loaded there.
 */
export function castTo(): Promise<void> {
  return native.castTo();
}

/** Back to this phone at the receiver's place; `resume` null plays on if the receiver played. */
export function stopCasting(resume: boolean | null = null): Promise<void> {
  return native.stopCasting(resume);
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

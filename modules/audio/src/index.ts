import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

/** A book for the player. The service keeps it to resume with the app closed. */
export type BookLoad = {
  bookId: string;
  title: string;
  author: string | null;
  coverUri: string | null;
  /**
   * In play order. `location` identifies the file in the library. `name` is the file's own name,
   * whose extension tells a cast receiver the type when the address has none (Subsonic).
   */
  files: { uri: string; location: string; title: string; durationMs: number; name?: string }[];
  /** On the whole-book timeline. */
  chapters: { title: string; startMs: number }[];
  startIndex: number;
  startPositionMs: number;
  speed: number;
  /** When the place was saved, so the first Play can rewind a little. */
  pausedAt: number | null;
  /**
   * At its end, play the next item in the queue: podcast episodes, and anything while a list
   * plays (M112). Otherwise a book stops at its end.
   */
  handsOver?: boolean;
  /** Sent with every request for this book's files: the login of a WebDAV server. */
  headers?: Record<string, string>;
  /**
   * The files' addresses carry a login (a Subsonic token): a cast receiver gets them through the
   * phone, never the address itself.
   */
  privateUris?: boolean;
  /** A podcast's intro and outro to skip (M45): from the first file's start, the last's end. */
  skipIntroMs?: number;
  skipOutroMs?: number;
  /**
   * The book's or show's own voice boost, skip silence and even loudness (M84); a missing key
   * follows the listener's default in `PlayerSettings`.
   */
  sound?: Partial<Record<'voiceEq' | 'skipSilence' | 'evenLoudness', boolean>>;
  /**
   * An episode's chapter pictures (M103), on the whole-book timeline, in order: the lock screen
   * and the car show each from its start; `uri` null goes back to the cover.
   */
  artworks?: { startMs: number; uri: string | null }[];
  /** Only an update of the book already loaded: the service ignores it for any other book. */
  onlyIfLoaded?: boolean;
};

/** A book or episode that played to its end, possibly with the app closed. */
export type FinishedItem = {
  bookId: string;
  at: number;
  /** Where the listening session that reached the end began (M102), when the service saw one. */
  startLocation?: string | null;
  startPositionMs?: number | null;
};

/** Player settings that must also work with the app closed. */
export type PlayerSettings = {
  /** During a call: true lowers the volume to `duckPercent`, false pauses until it ends. */
  duckOnInterruption: boolean;
  /** 20–100; also the level for Android's own short duck requests, such as navigation. */
  duckPercent: number;
  skipIntervalMs: number;
  smartRewind: boolean;
  /** Both channels mixed into one, for one earbud or one good ear. */
  mono: boolean;
  /**
   * Voice boost: rumble cut below 80 Hz, a gentle lift around 3 kHz, where consonants are, and
   * gentle compression (M84). This and the next two are defaults a book may override.
   */
  voiceEq: boolean;
  /** Pauses longer than 0.4 s are shortened (M84). */
  skipSilence: boolean;
  /** ReplayGain tags, or a slow measured gain, bring every book to about the same level (M84). */
  evenLoudness: boolean;
  /** +6 dB with a limiter, so loud parts never clip. */
  volumeBoost: boolean;
  /** In the sleep timer's last minutes, a shake adds ten more (Android). */
  shakeToExtend: boolean;
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
  /**
   * The title the lock screen shows: the chapter playing now, or the file's title in a book
   * without chapters. Not necessarily the part's own title.
   */
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
    duckLevel: number,
    skipIntervalMs: number,
    smartRewind: boolean,
    switches: Record<
      'mono' | 'voiceEq' | 'volumeBoost' | 'skipSilence' | 'evenLoudness' | 'shakeToExtend',
      boolean
    >,
  ): Promise<void>;
  silenceSavedMs(bookId: string): Promise<number>;
  skip(forward: boolean): Promise<void>;
  startSleepTimer(minutes: number): Promise<void>;
  startSleepTimerAtEnd(mode: 'chapter' | 'episode'): Promise<void>;
  cancelSleepTimer(): Promise<void>;
  unload(): Promise<void>;
  castTo(): Promise<void>;
  stopCasting(resume: boolean | null): Promise<void>;
  setQueue(queueJson: string, listNext: number): Promise<void>;
  takeFinished(): Promise<FinishedItem[]>;
  takeEarlierPlaces(): Promise<JournalEntry[]>;
  takeAccounting(): Promise<ServiceAccounting>;
  ackAccounting(epoch: string, through: number): Promise<void>;
  settleAccounting(): Promise<void>;
  setCarLibrary(json: string): Promise<void>;
  setBedtime(json: string | null): Promise<void>;
  getSleepPlace(): Promise<SleepPlace | null>;
  clearSleepPlace(): Promise<void>;
  setDiagnostics(on: boolean): Promise<void>;
  takeDiagnostics(): Promise<PlayerDiagnostic[]>;
  getState(): Promise<PlayerState>;
}

const native = requireNativeModule<LelapAudioModule>('LelapAudio');

/**
 * Loads a book, or updates the one loaded: the same book keeps its live place and takes new
 * chapters, an intro or outro, or other file addresses (a download that finished, went or
 * moved). Rejects when the service refuses the book, like every command it answers.
 */
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
    settings.duckPercent / 100,
    settings.skipIntervalMs,
    settings.smartRewind,
    {
      mono: settings.mono,
      voiceEq: settings.voiceEq,
      volumeBoost: settings.volumeBoost,
      skipSilence: settings.skipSilence,
      evenLoudness: settings.evenLoudness,
      shakeToExtend: settings.shakeToExtend,
    },
  );
}

/**
 * Hands the loaded book new settings that apply at its live place, such as its own sound (M84);
 * the service treats it as a load of the book it already has. Another book is left alone.
 */
export function updateBook(book: BookLoad): Promise<void> {
  return native.load(JSON.stringify({ ...book, onlyIfLoaded: true }), false);
}

/** Listening time skip silence saved in a book on this phone (M84). */
export function silenceSavedMs(bookId: string): Promise<number> {
  return native.silenceSavedMs(bookId);
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

/**
 * What plays after the current book when it hands over: Up Next in order, then the rest of the
 * list that plays (M112). `listNext` is where in `queue` the list's next item is, for the
 * notification's Next in list; null without a list.
 */
export function setQueue(queue: BookLoad[], listNext: number | null = null): Promise<void> {
  return native.setQueue(JSON.stringify(queue), listNext ?? -1);
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
 * The bedtime routine: when the window (minutes after local midnight; it may cross midnight)
 * opens while playing, or when playback starts inside it, the service starts a timer and plays at
 * `volume` percent until it ends, by itself, once per night.
 */
export type Bedtime = {
  startMinute: number;
  endMinute: number;
  /** To the end of the chapter instead of `minutes`. */
  chapter: boolean;
  minutes: number;
  /** Percent of the normal volume while the routine's timer runs; 100 keeps it. */
  volume: number;
};

/** Hands the service the bedtime routine; null turns it off. Works with the app closed. */
export function setBedtime(bedtime: Bedtime | null): Promise<void> {
  return native.setBedtime(bedtime ? JSON.stringify(bedtime) : null);
}

/**
 * Where and when the sleep timer stopped playback (M86), and where and when the listener last used
 * the player before that: the last moment they surely were awake. Positions are on the whole-book
 * timeline; times are wall-clock.
 */
export type SleepPlace = {
  bookId: string;
  stoppedMs: number;
  stoppedAt: number;
  /** Null when they didn't touch the player in this book before the stop. */
  usedMs: number | null;
  usedAt: number | null;
};

/** The place the timer last left, kept until the app clears it. */
export function getSleepPlace(): Promise<SleepPlace | null> {
  return native.getSleepPlace();
}

export function clearSleepPlace(): Promise<void> {
  return native.clearSleepPlace();
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

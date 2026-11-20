import {
  getBook,
  getSettings,
  type HistoryAction,
  type HistoryEntry,
  type HistoryReport,
  playerProfileOf,
  pruneHistory,
  readReport,
  recordHistory,
  skipLanding,
  type TimelineFile,
  toBookPosition,
} from '@lelap/core';
import { useEffect, useState } from 'react';

import { db } from './db';
import { logCaught } from './diagnostics';
import * as audio from './platform/audio';
import { profileId } from './profile';

// Playback history (M138). The app logs its own taps here, knowing what they were (a chapter, a
// bookmark); the Android service and the web player keep what came from elsewhere (notification,
// headphones, car, media keys, the sleep timer) until `foldHistory` takes it.

type Listener = (entry: HistoryEntry) => void;
const listeners = new Set<Listener>();

/** Calls [listener] with every entry as it is kept; returns the way to stop. */
export function onHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function keep(profile: string, report: HistoryReport): void {
  try {
    const entry = recordHistory(db, profile, report, Date.now());
    if (entry) for (const listener of listeners) listener(entry);
  } catch (e) {
    logCaught(e);
  }
}

/** A number bumped whenever an entry is kept, for screens that show the log. */
export function useHistoryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onHistory(() => setVersion((v) => v + 1)), []);
  return version;
}

/** The profile the player plays for, whose log its taps go to, even after a switch on screen. */
const tapProfile = () => playerProfileOf(db, profileId);

/** The loaded book's place now: whole-book, and in its file. */
type Place = {
  bookId: string;
  ms: number;
  files: TimelineFile[];
  location: string;
  positionMs: number;
};

async function placeNow(): Promise<Place | null> {
  const state = await audio.getState();
  if (!state.bookId || !state.fileLocation) return null;
  const detail = getBook(db, tapProfile(), state.bookId);
  if (!detail) return null;
  return {
    bookId: state.bookId,
    ms: toBookPosition(detail.files, state.fileLocation, state.positionMs),
    files: detail.files,
    location: state.fileLocation,
    positionMs: state.positionMs,
  };
}

/**
 * Runs one of the listener's own taps in the app and logs it with the place before and after.
 * [to] says where a skip or seek goes from the place before: the player may not have moved yet
 * when its call returns. Without it the place stays.
 */
export async function logged(
  action: Exclude<HistoryAction, 'sleep'>,
  run: () => Promise<void>,
  to?: (before: Place) => number,
  bookId?: string,
): Promise<void> {
  const before = await placeNow().catch(() => null);
  await run();
  // Right after a load the player may still report the last book; that place says nothing here.
  if (!before || (bookId !== undefined && before.bookId !== bookId)) return;
  keep(tapProfile(), {
    bookId: before.bookId,
    action,
    source: 'app',
    at: Date.now(),
    fromMs: before.ms,
    toMs: to ? to(before) : before.ms,
  });
}

/** Play or pause from one of the app's buttons. */
export function playPause(playing: boolean): Promise<void> {
  return playing ? logged('pause', audio.pause) : logged('play', audio.play);
}

/** Back or forward by the skip interval from one of the app's buttons. */
export function skip(forward: boolean): Promise<void> {
  // The player skips by the interval of the profile it plays for.
  const step = getSettings(db, tapProfile()).skipIntervalMs * (forward ? 1 : -1);
  return logged(
    'skip',
    () => audio.skip(forward),
    (p) => skipLanding(p.files, p.location, p.positionMs, step),
  );
}

/** Setting, changing or turning off the sleep timer: it counts as use for M86's offer. */
export function timer(run: () => Promise<void>): Promise<void> {
  return logged('timer', run);
}

let folding = false;

/** Takes what the player kept away from the app into [profile]'s log (the profile it played for). */
export async function foldHistory(profile: string): Promise<void> {
  if (folding) return;
  folding = true;
  try {
    const items = await audio.takeHistory();
    for (const item of items) {
      const report = readReport(item);
      if (report) keep(profile, report);
    }
  } catch (e) {
    logCaught(e);
  } finally {
    folding = false;
  }
}

/** Drops entries past the 30 days; once at start. */
export function pruneOldHistory(): void {
  try {
    pruneHistory(db, Date.now());
  } catch (e) {
    logCaught(e);
  }
}

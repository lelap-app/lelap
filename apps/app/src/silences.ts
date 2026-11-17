import {
  type BookDetail,
  getBook,
  saveFoundChapters,
  type Silence,
  SILENCE_RULES,
  silenceChapters,
} from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { queryClient } from './addons';
import { db, newId } from './db';
import { t } from './i18n';
import * as library from './platform/library';
import { reloadBook, useLibrary } from './player';
import { profileId } from './profile';

// Chapters from silences (M45). Android decodes the book's own files in a background worker;
// the web does not offer it (see docs/brief.md, “Chapters”).

const SCANS_KEY = ['silences'];
const POLL_RUNNING_MS = 3_000;
const POLL_WAITING_MS = 15_000;

export type SilenceScan = library.SilenceStatus;

/** Where each file of the book plays from on this phone, or null if one is on a server. */
function localFiles(detail: BookDetail): string[] | null {
  const uris = detail.files.map((f) =>
    f.downloadPath ? `file://${f.downloadPath}` : f.uri.startsWith('content://') ? f.uri : null,
  );
  return uris.every((u): u is string => u !== null) ? uris : null;
}

/**
 * Whether the listener can have chapters found for a book: a book (not an episode) with no
 * chapters at all, whose files are all on this phone.
 */
export function canFindChapters(detail: BookDetail | null): boolean {
  if (!library.SILENCE_SCAN || !detail) return false;
  if (detail.chapters.length > 0 || detail.book.source === 'feed') return false;
  return detail.files.length > 0 && localFiles(detail) !== null;
}

export async function findChapters(bookId: string): Promise<void> {
  const detail = getBook(db, profileId, bookId);
  const files = detail ? localFiles(detail) : null;
  if (!files) return;
  await library.findSilences({
    bookId,
    files,
    thresholdDb: SILENCE_RULES.thresholdDb,
    minSilenceMs: SILENCE_RULES.minSilenceMs,
  });
  await queryClient.invalidateQueries({ queryKey: SCANS_KEY });
}

/** Stops a scan, or clears one that failed. */
export async function stopFindingChapters(bookId: string): Promise<void> {
  await library.removeSilences(bookId);
  await queryClient.invalidateQueries({ queryKey: SCANS_KEY });
}

/**
 * Turns finished scans into chapters. A scan that found none stays listed as done with no
 * chapters stored, so the sheet can say so; the next scan replaces it.
 */
async function foldScans(onChange: () => void): Promise<Map<string, SilenceScan>> {
  const scans = await library.silenceStatuses();
  let changed = false;
  for (const scan of scans) {
    if (scan.state !== 'done' || scan.result === null) continue;
    const detail = getBook(db, profileId, scan.bookId);
    let scanned: { durationMs: number; silences: Silence[] }[] = [];
    try {
      scanned = JSON.parse(scan.result) as typeof scanned;
    } catch {
      // An unreadable result finds nothing.
    }
    // Files sit on the book's timeline by their stored lengths, which the player uses too; a
    // part stored without one (some downloads) takes its decoded length.
    const chapters = detail
      ? silenceChapters(
          detail.files.map((f, i) => ({
            durationMs: f.durationMs > 0 ? f.durationMs : (scanned[i]?.durationMs ?? 0),
            silences: scanned[i]?.silences ?? [],
          })),
          (n) => t('Part {n}', { n }),
        )
      : [];
    if (chapters.length > 0 && saveFoundChapters(db, scan.bookId, chapters, Date.now(), newId)) {
      changed = true;
      await library.removeSilences(scan.bookId);
      // The player shows the chapter on the lock screen once the book is loaded again.
      await reloadBook(scan.bookId, false).catch(() => {});
    } else if (!detail || detail.chapters.length > 0) {
      // The book is gone, or has chapters from elsewhere by now.
      await library.removeSilences(scan.bookId);
    }
  }
  if (changed) onChange();
  return new Map(
    (changed ? await library.silenceStatuses() : scans).map((s) => [s.bookId, s] as const),
  );
}

/** Scans by book ID, polled while one is waiting or running. */
export function useSilenceScans(): Map<string, SilenceScan> {
  const { refresh } = useLibrary();
  const query = useQuery({
    queryKey: SCANS_KEY,
    queryFn: () => foldScans(refresh),
    enabled: library.SILENCE_SCAN,
    refetchInterval: (q) => {
      const states = [...(q.state.data?.values() ?? [])].map((s) => s.state);
      if (states.includes('running')) return POLL_RUNNING_MS;
      return states.includes('waiting') ? POLL_WAITING_MS : false;
    },
  });
  return query.data ?? new Map();
}

/** Folds finished scans in while the app runs and when it returns to the foreground. */
export function SilenceSync() {
  useSilenceScans();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void queryClient.invalidateQueries({ queryKey: SCANS_KEY });
    });
    return () => subscription.remove();
  }, []);
  return null;
}

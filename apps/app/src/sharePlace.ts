import { placeOfBook, placeUrl } from '@lelap/core';
import { Platform, Share } from 'react-native';

import { webBase } from './config';
import { db } from './db';
import { showAlert } from './dialog';
import { formatClock } from './format';
import { t } from './i18n';

/** How far back “Last 30 seconds” reaches. */
export const CLIP_BACK_MS = 30_000;

/**
 * Shares a link to a place in a book (M85), or to a short clip from `atMs` to `toMs`: only which
 * book and where, never the audio. Whoever opens it plays their own copy.
 */
export async function sharePlace(
  bookId: string,
  atMs: number,
  toMs: number | null = null,
): Promise<void> {
  const place = placeOfBook(db, bookId, atMs, toMs);
  if (!place) return;
  const url = placeUrl(webBase, place);
  const time =
    place.toMs === null
      ? formatClock(place.atMs)
      : `${formatClock(place.atMs)}–${formatClock(place.toMs)}`;
  const message = t('{title}, at {time}: {url}', { title: place.title, time, url });
  // Most desktop browsers have no share sheet; the link goes to the clipboard there.
  if (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    typeof (navigator.share as unknown) !== 'function'
  ) {
    // No clipboard outside a secure page, or it was refused: the alert shows the link to copy.
    const copied = await navigator.clipboard
      ?.writeText(url)
      .then(() => true)
      .catch(() => false);
    showAlert(copied ? t('Link copied') : t('Share this place'), message);
    return;
  }
  try {
    await Share.share({ message });
  } catch {
    // The listener closed the share sheet.
  }
}

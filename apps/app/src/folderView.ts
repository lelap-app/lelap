import { bookSwitch, listFolderEpisodes, showAsBook, showAsPodcast } from '@lelap/core';

import { t } from './i18n';
import { db } from './db';
import { showAlert } from './dialog';
import { reloadBook } from './player';
import { profileId } from './profile';

/** Shows a book of episode files as a podcast (M157); nothing about its place changes. */
export function switchToPodcast(bookId: string): void {
  showAsPodcast(db, profileId, bookId, Date.now());
}

/**
 * Shows a podcast book as a book again. It continues from the episode being heard, else the
 * first one not played; when played episodes come after that, the listener is told first.
 */
export function switchToBook(bookId: string, done: () => void): void {
  const target = bookSwitch(db, profileId, bookId);
  const go = () => {
    showAsBook(db, profileId, bookId, Date.now());
    // A paused book in the player takes the new place.
    void reloadBook(bookId, false).catch(() => {});
    done();
  };
  if (!target || target.laterPlayed === 0) {
    go();
    return;
  }
  const episode = listFolderEpisodes(db, profileId, bookId)[target.index]?.title ?? '';
  showAlert(
    t('Show as a book?'),
    target.laterPlayed === 1
      ? t(
          'As a book, Lelap continues from {episode}. 1 played episode after it keeps its mark for when you show it as a podcast again.',
          { episode },
        )
      : t(
          'As a book, Lelap continues from {episode}. {n} played episodes after it keep their marks for when you show it as a podcast again.',
          { episode, n: target.laterPlayed },
        ),
    [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Show as book'), onPress: go },
    ],
  );
}

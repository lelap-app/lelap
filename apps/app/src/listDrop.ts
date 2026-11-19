import { addToPlaylist, type DragItem, episodeBook, type Playlist } from '@lelap/core';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { addWork } from './addons';
import { db, newId } from './db';
import { showAlert } from './dialog';
import { t } from './i18n';
import { useLibrary } from './player';
import { profileId } from './profile';

/**
 * What a list does with an item dropped on it (M113, M120), in the rail or on the Library's list
 * cards: adds the book, the episode's book, or a catalog item, which joins the library first.
 * A smart list picks its own books, so it takes no drop.
 */
export function useListDrop(list: Pick<Playlist, 'id' | 'name' | 'rule'>) {
  const { refresh } = useLibrary();
  // `adding` while a catalog item's sources are asked for; `added` for a moment after.
  const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');
  const takes = list.rule === null;
  useEffect(() => {
    if (state !== 'added') return;
    const timer = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [state]);

  const bookFor = async (item: DragItem): Promise<string> => {
    if (item.kind === 'work') return addWork(item.type, item.id);
    if (item.kind === 'episode') return episodeBook(db, item.id, Date.now(), newId);
    return item.id;
  };

  const drop = (item: DragItem) => {
    if (!takes) return;
    if (item.kind === 'work') setState('adding');
    void (async () => {
      try {
        const bookId = await bookFor(item);
        const fresh = addToPlaylist(db, profileId, list.id, bookId, Date.now());
        refresh();
        setState('added');
        AccessibilityInfo.announceForAccessibility(
          fresh
            ? t('Added to {name}', { name: list.name })
            : t('Already in {name}', { name: list.name }),
        );
      } catch (error) {
        setState('idle');
        showAlert(t('Lists'), error instanceof Error ? error.message : String(error));
      }
    })();
  };

  return { takes, drop, adding: state === 'adding', added: state === 'added' };
}

import {
  addToPlaylist,
  type DragItem,
  episodeBook,
  listPlaylists,
  type Playlist,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import { db, newId } from '../db';
import { showAlert } from '../dialog';
import { DropTarget, useDragging } from '../drag';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { COLORS, Icon } from './Icon';

/** One list in the rail: opens it, and on the web takes a book or an episode dropped on it. */
function RailList({ list }: { list: Playlist }) {
  const router = useRouter();
  const { refresh } = useLibrary();
  const dragging = useDragging();
  const [added, setAdded] = useState(false);
  // A smart list picks its own books, so it takes no drop.
  const takes = list.rule === null;
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), 1500);
    return () => clearTimeout(timer);
  }, [added]);

  const drop = (item: DragItem) => {
    if (!takes) return;
    const now = Date.now();
    try {
      const bookId = item.kind === 'episode' ? episodeBook(db, item.id, now, newId) : item.id;
      const fresh = addToPlaylist(db, profileId, list.id, bookId, now);
      refresh();
      setAdded(true);
      AccessibilityInfo.announceForAccessibility(
        fresh
          ? t('Added to {name}', { name: list.name })
          : t('Already in {name}', { name: list.name }),
      );
    } catch (error) {
      showAlert(t('Lists'), error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <DropTarget onDrop={drop} enabled={takes}>
      {(over) => {
        const lit = takes && (over || added);
        // Lit while a drag is over it and just after a drop: where it lands, not a choice.
        const frame = lit
          ? 'border-amber bg-night'
          : takes && dragging
            ? 'border-line'
            : 'border-transparent';
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/list', params: { id: list.id } })}
            accessibilityRole="button"
            accessibilityLabel={list.name}
            className={`min-h-12 min-w-12 items-center gap-1 rounded-xl border px-1 py-2 active:bg-night ${frame}`}
          >
            <Icon
              name={added ? 'check' : 'chapters'}
              size={20}
              color={lit ? COLORS.amber : COLORS.muted}
            />
            <Text
              numberOfLines={2}
              className={`text-center text-xs ${lit ? 'text-amber' : 'text-soft'}`}
            >
              {added ? t('Added') : list.name}
            </Text>
          </Pressable>
        );
      }}
    </DropTarget>
  );
}

/**
 * The listener's lists under the rail's tabs (M113), so a book or an episode can be dragged onto
 * one with a mouse. Hidden while there are none.
 */
export function RailLists() {
  const { version } = useLibrary();
  // `version` is the signal to re-read the database.
  const lists = useMemo(() => listPlaylists(db, profileId), [version]);
  if (lists.length === 0) return null;
  return (
    <View className="flex-1 border-t border-line pt-2">
      <Text
        accessibilityRole="header"
        className="px-1 pb-1 text-center text-xs uppercase tracking-wider text-muted"
      >
        {t('Lists')}
      </Text>
      <ScrollView contentContainerStyle={{ gap: 4, paddingHorizontal: 6, paddingBottom: 12 }}>
        {lists.map((list) => (
          <RailList key={list.id} list={list} />
        ))}
      </ScrollView>
    </View>
  );
}

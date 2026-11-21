import { listPlaylists, type Playlist } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { t } from '../i18n';
import { db } from '../db';
import { DropTarget, useDragging } from '../drag';
import { useListDrop } from '../listDrop';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { Icon } from './Icon';
import { useColors } from '../theme';

/** One list in the rail: opens it, and takes a book, an episode or a catalog item dropped on it. */
function RailList({ list }: { list: Playlist }) {
  const colors = useColors();
  const router = useRouter();
  const dragging = useDragging();
  const { takes, drop, adding, added } = useListDrop(list);

  return (
    <DropTarget onDrop={drop} enabled={takes} rail>
      {(over) => {
        const lit = takes && (over || adding || added);
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
              color={lit ? colors.amber : colors.muted}
            />
            <Text
              numberOfLines={2}
              className={`text-center text-caption ${lit ? 'text-amber' : 'text-soft'}`}
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
 * The listener's lists under the rail's tabs (M113), so a book, an episode or a catalog item can
 * be dragged onto one. Hidden while there are none.
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
        className="px-1 pb-1 text-center text-caption uppercase tracking-wider text-muted"
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

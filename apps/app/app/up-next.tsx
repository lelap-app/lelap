import { listUpNext, moveInUpNext, removeFromUpNext } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { openPlayer } from '../src/navigation';
import { showAlert } from '../src/dialog';
import { Icon } from '../src/components/Icon';
import { EmptyState } from '../src/components/EmptyState';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { BookCover, coverUri } from '../src/components/BookCover';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { db } from '../src/db';
import { formatDuration } from '../src/format';
import { playBook, playQueuedEpisode, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { ROW_BUTTON } from '../src/components/TextButton';
import { LIST_COLUMN } from '../src/layout';
import { useColors } from '../src/theme';

/** The queue: a podcast episode that ends plays the first item here; a book stops. */
export default function UpNextScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  // `version` is the signal to re-read the database.
  const items = useMemo(() => listUpNext(db, profileId), [version]);

  const move = (bookId: string, index: number) => {
    moveInUpNext(db, profileId, bookId, index, Date.now());
    refresh();
  };

  return (
    <View className="flex-1 bg-night">
      <FlatList
        data={items}
        keyExtractor={(i) => i.bookId}
        contentContainerStyle={{ ...LIST_COLUMN, paddingTop: insets.top + 8, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="px-4">
            <ScreenHeader
              title={t('Up next')}
              subtitle={t(
                'When a podcast episode ends, the first item here plays. Books stop at their end.',
              )}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            lori
            title={t('Nothing in Up next')}
            body={t('Long-press an episode to play it next or add it here.')}
          />
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() =>
              void (
                item.episode
                  ? playQueuedEpisode(item.bookId, item.episode.location)
                  : playBook(item.bookId)
              )
                .then(() => openPlayer(router))
                .catch((error: unknown) =>
                  showAlert(
                    t('Cannot play'),
                    error instanceof Error ? error.message : String(error),
                  ),
                )
            }
            {...ROW_BUTTON}
            className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
          >
            <BookCover uri={coverUri(item)} title={item.title} size={48} />
            <View className="flex-1 gap-1">
              <Text numberOfLines={2} className="text-body text-paper">
                {item.episode?.title ?? item.title}
              </Text>
              <Text numberOfLines={1} className="text-detail text-muted">
                {[
                  // One episode of a book shown as a podcast (M158) names its show.
                  item.episode ? item.title : item.author,
                  item.durationMs > 0 ? formatDuration(item.durationMs) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <View className="flex-row">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Move up')}
                className="h-12 w-12 items-center justify-center"
                disabled={index === 0}
                onPress={() => move(item.bookId, index - 1)}
              >
                <Icon name="up" size={22} color={index === 0 ? colors.line : colors.soft} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Move down')}
                className="h-12 w-12 items-center justify-center"
                disabled={index === items.length - 1}
                onPress={() => move(item.bookId, index + 1)}
              >
                <Icon
                  name="down"
                  size={22}
                  color={index === items.length - 1 ? colors.line : colors.soft}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('Remove from Up next')}
                className="h-12 w-12 items-center justify-center"
                onPress={() => {
                  removeFromUpNext(db, profileId, item.bookId);
                  refresh();
                }}
              >
                <Icon name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <MiniPlayer />
    </View>
  );
}

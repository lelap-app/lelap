import { listUpNext, moveInUpNext, removeFromUpNext } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { COLORS, Icon, IconButton } from '../src/components/Icon';
import { BookCover, coverUri } from '../src/components/BookCover';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { db } from '../src/db';
import { formatDuration } from '../src/format';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

/** The queue: a podcast episode that ends plays the first item here; a book stops. */
export default function UpNextScreen() {
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
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-2 px-4 pb-4">
            <View className="-ml-2 self-start">
              <IconButton
                name="back"
                label={t('Back')}
                color={COLORS.soft}
                onPress={() => router.back()}
              />
            </View>
            <Text className="text-3xl font-semibold text-paper">{t('Up Next')}</Text>
            <Text className="text-sm text-muted">
              {t(
                'When a podcast episode ends, the first item here plays. Books stop at their end.',
              )}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 pt-8 text-center text-muted">
            {t('Long-press an episode to play it next or add it here.')}
          </Text>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() =>
              void playBook(item.bookId)
                .then(() => router.push('/player'))
                .catch((error: unknown) =>
                  showAlert(
                    t('Cannot play'),
                    error instanceof Error ? error.message : String(error),
                  ),
                )
            }
            className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
          >
            <BookCover uri={coverUri(item)} title={item.title} size={48} />
            <View className="flex-1 gap-1">
              <Text numberOfLines={2} className="text-base text-paper">
                {item.title}
              </Text>
              <Text numberOfLines={1} className="text-sm text-muted">
                {[item.author, item.durationMs > 0 ? formatDuration(item.durationMs) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <View className="flex-row gap-4">
              <Pressable
                hitSlop={8}
                accessibilityLabel={t('Move up')}
                disabled={index === 0}
                onPress={() => move(item.bookId, index - 1)}
              >
                <Icon name="up" size={22} color={index === 0 ? COLORS.line : COLORS.soft} />
              </Pressable>
              <Pressable
                hitSlop={8}
                accessibilityLabel={t('Move down')}
                disabled={index === items.length - 1}
                onPress={() => move(item.bookId, index + 1)}
              >
                <Icon
                  name="down"
                  size={22}
                  color={index === items.length - 1 ? COLORS.line : COLORS.soft}
                />
              </Pressable>
              <Pressable
                hitSlop={8}
                accessibilityLabel={t('Remove from Up Next')}
                onPress={() => {
                  removeFromUpNext(db, profileId, item.bookId);
                  refresh();
                }}
              >
                <Icon name="close" size={22} color={COLORS.muted} />
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <MiniPlayer />
    </View>
  );
}

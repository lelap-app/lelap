import { listUpNext, moveInUpNext, removeFromUpNext } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
            <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
              <Text className="text-2xl text-muted">‹</Text>
            </Pressable>
            <Text className="text-3xl font-semibold text-paper">Up Next</Text>
            <Text className="text-sm text-muted">
              When a podcast episode ends, the first item here plays. Books stop at their end.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 pt-8 text-center text-muted">
            Long-press an episode to play it next or add it here.
          </Text>
        }
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() =>
              void playBook(item.bookId)
                .then(() => router.push('/player'))
                .catch((error: unknown) =>
                  Alert.alert(
                    'Cannot play',
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
                disabled={index === 0}
                onPress={() => move(item.bookId, index - 1)}
              >
                <Text className={index === 0 ? 'text-line' : 'text-soft'}>▲</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                disabled={index === items.length - 1}
                onPress={() => move(item.bookId, index + 1)}
              >
                <Text className={index === items.length - 1 ? 'text-line' : 'text-soft'}>▼</Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  removeFromUpNext(db, profileId, item.bookId);
                  refresh();
                }}
              >
                <Text className="text-muted">✕</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <MiniPlayer />
    </View>
  );
}

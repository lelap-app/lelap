import type { Bookmark } from '@lelap/core';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { formatClock } from '../format';
import { Sheet } from './Sheet';

export function BookmarksSheet({
  visible,
  bookmarks,
  onPick,
  onDelete,
  onClose,
}: {
  visible: boolean;
  bookmarks: Bookmark[];
  onPick: (bookmark: Bookmark) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const confirmDelete = (bookmark: Bookmark) =>
    Alert.alert('Delete bookmark?', bookmark.note ?? formatClock(bookmark.bookPositionMs), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(bookmark.id) },
    ]);

  return (
    <Sheet visible={visible} title="Bookmarks" onClose={onClose}>
      {bookmarks.length === 0 ? (
        <Text className="pb-4 text-muted">No bookmarks yet. Tap “+ Bookmark” while listening.</Text>
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              onLongPress={() => confirmDelete(item)}
              className="flex-row items-center gap-3 py-3 active:opacity-60"
            >
              <Text className="w-20 text-amber">{formatClock(item.bookPositionMs)}</Text>
              <View className="flex-1">
                <Text numberOfLines={2} className={item.note ? 'text-paper' : 'text-muted'}>
                  {item.note ?? 'No note'}
                </Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            <Text className="py-2 text-xs text-muted">Long press a bookmark to delete it.</Text>
          }
        />
      )}
    </Sheet>
  );
}

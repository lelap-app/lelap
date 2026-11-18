import type { Bookmark } from '@lelap/core';
import { FlatList, Pressable, Text, View } from 'react-native';

import { deleteKeyAction } from '../a11y';
import { t } from '../i18n';
import { showAlert } from '../dialog';
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
    showAlert(t('Delete bookmark?'), bookmark.note ?? formatClock(bookmark.bookPositionMs), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => onDelete(bookmark.id) },
    ]);

  return (
    <Sheet visible={visible} title={t('Bookmarks')} onClose={onClose}>
      {bookmarks.length === 0 ? (
        <Text className="pb-4 text-muted">
          {t('No bookmarks yet. Tap “Add bookmark” while listening.')}
        </Text>
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item)}
              onLongPress={() => confirmDelete(item)}
              accessibilityRole="button"
              // TalkBack lists this under its actions, so nobody has to find the long press.
              accessibilityActions={[{ name: 'delete', label: t('Delete') }]}
              onAccessibilityAction={() => confirmDelete(item)}
              {...deleteKeyAction(t('Delete'), () => confirmDelete(item))}
              className="flex-row items-center gap-3 py-3 active:opacity-60"
            >
              <Text className="w-20 text-amber">{formatClock(item.bookPositionMs)}</Text>
              <View className="flex-1">
                <Text numberOfLines={2} className={item.note ? 'text-paper' : 'text-muted'}>
                  {item.note ?? t('No note')}
                </Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            <Text className="py-2 text-xs text-muted">
              {t('Long press a bookmark to delete it.')}
            </Text>
          }
        />
      )}
    </Sheet>
  );
}

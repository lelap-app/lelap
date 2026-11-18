import {
  type BookmarkInBook,
  deleteBookmark,
  listAllBookmarks,
  setBookmarkNote,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookCover, coverUri } from '../src/components/BookCover';
import { BookmarkEditor, BookmarkRow } from '../src/components/BookmarksSheet';
import { COLORS, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { Sheet } from '../src/components/Sheet';
import { db } from '../src/db';
import { showAlert } from '../src/dialog';
import { t } from '../src/i18n';
import { READABLE } from '../src/layout';
import { openPlayer } from '../src/navigation';
import { playAt, useLibrary } from '../src/player';
import { profileId } from '../src/profile';
import { canSharePlace, sharePlace } from '../src/sharePlace';

/** Every bookmark across the listener's books (M85), newest first. */
export default function BookmarksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  // `version` is the signal to re-read the database.
  const marks = useMemo(() => listAllBookmarks(db, profileId), [version]);
  const [editing, setEditing] = useState<BookmarkInBook | null>(null);

  const play = (mark: BookmarkInBook) =>
    void playAt(mark.bookId, mark.bookPositionMs)
      .then(() => openPlayer(router))
      .catch((error: unknown) =>
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error)),
      );

  const remove = (id: string) => {
    deleteBookmark(db, profileId, id);
    refresh();
  };

  return (
    <View className="flex-1 bg-night">
      <FlatList
        data={marks}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24, ...READABLE }}
        ListHeaderComponent={
          <View className="gap-2 px-4 pb-4">
            <View className="-ms-2 self-start">
              <IconButton
                name="back"
                label={t('Back')}
                color={COLORS.soft}
                onPress={() => router.back()}
              />
            </View>
            <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
              {t('Bookmarks')}
            </Text>
            <Text className="text-sm text-muted">
              {t(
                'Tap a bookmark to play from there. Long press it to change its note, share it or delete it.',
              )}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text className="px-4 pt-8 text-center text-muted">
            {t('No bookmarks yet. Tap “Add bookmark” while listening.')}
          </Text>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center gap-3 px-4">
            <BookCover uri={coverUri(item.book)} title={item.book.title} size={48} />
            <View className="flex-1">
              <BookmarkRow
                bookmark={item}
                above={[item.book.title, item.chapter].filter(Boolean).join(' · ')}
                onPick={() => play(item)}
                onEdit={() => setEditing(item)}
                onDelete={() => remove(item.id)}
              />
            </View>
          </View>
        )}
      />
      <MiniPlayer />
      <Sheet visible={editing !== null} title={t('Bookmark')} onClose={() => setEditing(null)}>
        {editing && (
          <BookmarkEditor
            key={editing.id}
            bookmark={editing}
            onSave={(note) => {
              setBookmarkNote(db, profileId, editing.id, note, Date.now());
              setEditing(null);
              refresh();
            }}
            {...(canSharePlace(editing.bookId)
              ? { onShare: () => void sharePlace(editing.bookId, editing.bookPositionMs) }
              : {})}
            onDelete={() => {
              remove(editing.id);
              setEditing(null);
            }}
          />
        )}
      </Sheet>
    </View>
  );
}

import type { Bookmark } from '@lelap/core';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { deleteKeyAction } from '../a11y';
import { t } from '../i18n';
import { showAlert } from '../dialog';
import { formatClock } from '../format';
import { Sheet } from './Sheet';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

/** Asks before a bookmark is deleted. */
export function confirmDeleteBookmark(bookmark: Bookmark, onDelete: () => void): void {
  showAlert(t('Delete bookmark?'), bookmark.note ?? formatClock(bookmark.bookPositionMs), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Delete'), style: 'destructive', onPress: onDelete },
  ]);
}

/** A bookmark's note to change (M85), and its place to share or the bookmark to delete. */
export function BookmarkEditor({
  bookmark,
  onSave,
  onShare,
  onDelete,
}: {
  bookmark: Bookmark;
  onSave: (note: string) => void;
  /** Left out where a place can't be shared, such as in a podcast episode. */
  onShare?: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const [note, setNote] = useState(bookmark.note ?? '');
  return (
    <View className="gap-3 pb-2">
      <Text className="text-amber">{formatClock(bookmark.bookPositionMs)}</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t('Add a note (optional)')}
        accessibilityLabel={t('Note')}
        placeholderTextColor={colors.muted}
        multiline
        autoFocus
        className="min-h-24 rounded-lg border border-line px-3 py-2 text-paper"
      />
      <View className="flex-row flex-wrap items-center justify-end gap-x-2">
        <TextButton
          text={t('Delete')}
          onPress={() => confirmDeleteBookmark(bookmark, onDelete)}
          tone="danger"
        />
        {onShare && (
          <TextButton
            text={t('Share')}
            accessibilityLabel={t('Share this place')}
            onPress={onShare}
          />
        )}
        <TextButton text={t('Save')} onPress={() => onSave(note)} strong />
      </View>
    </View>
  );
}

/** One bookmark in a list: tap to go there, long press to change its note, share or delete it. */
export function BookmarkRow({
  bookmark,
  onPick,
  onEdit,
  onDelete,
  above,
}: {
  bookmark: Bookmark;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** A line over the note, such as the book's title in the list of all bookmarks. */
  above?: string;
}) {
  return (
    <Pressable
      onPress={onPick}
      onLongPress={onEdit}
      accessibilityRole="button"
      // TalkBack lists these under its actions, so nobody has to find the long press.
      accessibilityActions={[
        { name: 'edit', label: t('Edit note') },
        { name: 'delete', label: t('Delete') },
      ]}
      onAccessibilityAction={(e) =>
        e.nativeEvent.actionName === 'delete' ? confirmDeleteBookmark(bookmark, onDelete) : onEdit()
      }
      {...deleteKeyAction(t('Delete'), () => confirmDeleteBookmark(bookmark, onDelete))}
      className="flex-row items-center gap-3 py-3 active:opacity-60"
    >
      <Text className="w-20 text-amber">{formatClock(bookmark.bookPositionMs)}</Text>
      <View className="flex-1 gap-0.5">
        {above !== undefined && (
          <Text numberOfLines={1} className="text-sm text-soft">
            {above}
          </Text>
        )}
        <Text numberOfLines={3} className={bookmark.note ? 'text-paper' : 'text-muted'}>
          {bookmark.note ?? t('No note')}
        </Text>
      </View>
    </Pressable>
  );
}

export function BookmarksSheet({
  visible,
  bookmarks,
  onPick,
  onDelete,
  onSaveNote,
  onShare,
  onShareHere,
  onShareClip,
  canShare,
  onClose,
}: {
  visible: boolean;
  bookmarks: Bookmark[];
  onPick: (bookmark: Bookmark) => void;
  onDelete: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
  onShare: (bookmark: Bookmark) => void;
  /** Shares the place playing now. */
  onShareHere: () => void;
  /** Shares the last 30 seconds as a short clip. */
  onShareClip: () => void;
  /** Places in books can be shared; places in podcast episodes not yet. */
  canShare: boolean;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={editing ? t('Bookmark') : t('Bookmarks')}
      onClose={editing ? () => setEditing(null) : close}
    >
      {editing ? (
        <BookmarkEditor
          key={editing.id}
          bookmark={editing}
          onSave={(note) => {
            onSaveNote(editing.id, note);
            setEditing(null);
          }}
          {...(canShare ? { onShare: () => onShare(editing) } : {})}
          onDelete={() => {
            onDelete(editing.id);
            setEditing(null);
          }}
        />
      ) : (
        <>
          {canShare && (
            <View className="flex-row flex-wrap items-center gap-x-2 pb-2">
              <Text className="flex-1 text-sm text-muted">{t('Share a link to this place:')}</Text>
              <TextButton text={t('From here')} onPress={onShareHere} />
              <TextButton text={t('Last 30 seconds')} onPress={onShareClip} />
            </View>
          )}
          {bookmarks.length === 0 ? (
            <Text className="pb-4 text-muted">
              {t('No bookmarks yet. Tap “Add bookmark” while listening.')}
            </Text>
          ) : (
            <FlatList
              data={bookmarks}
              keyExtractor={(b) => b.id}
              renderItem={({ item }) => (
                <BookmarkRow
                  bookmark={item}
                  onPick={() => onPick(item)}
                  onEdit={() => setEditing(item)}
                  onDelete={() => onDelete(item.id)}
                />
              )}
              ListFooterComponent={
                <Text className="py-2 text-xs text-muted">
                  {t('Long press a bookmark to change its note, share it or delete it.')}
                </Text>
              }
            />
          )}
        </>
      )}
    </Sheet>
  );
}

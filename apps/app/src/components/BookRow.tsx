import type { LibraryBook } from '@lelap/core';
import { memo } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { COLORS, IconButton } from './Icon';

function status(book: LibraryBook): string {
  if (book.missing) return t('Files not found');
  if (book.finishedAt !== null) return t('✓ Finished');
  if (book.bookPositionMs <= 0) return t('New');
  if (book.durationMs <= 0) return t('Started');
  return `${Math.min(99, Math.floor((book.bookPositionMs / book.durationMs) * 100))} %`;
}

export const BookRow = memo(function BookRow({
  book,
  onOpen,
  onLongPress,
  unavailable = false,
}: {
  book: LibraryBook;
  /** Offline and not on this phone: shown dimmed. */
  unavailable?: boolean;
  onOpen: (book: LibraryBook) => void;
  onLongPress: (book: LibraryBook) => void;
}) {
  const progress = book.durationMs > 0 ? Math.min(1, book.bookPositionMs / book.durationMs) : 0;
  return (
    <Pressable
      onPress={() => onOpen(book)}
      onLongPress={() => onLongPress(book)}
      className={`flex-row items-center gap-3 px-4 py-2 active:bg-raised ${book.missing || unavailable ? 'opacity-40' : ''}`}
    >
      <BookCover uri={coverUri(book)} title={book.title} size={56} />
      <View className="flex-1 gap-1">
        <Text numberOfLines={2} className="text-base text-paper">
          {book.title}
        </Text>
        {(book.author !== null || book.source === 'addon') && (
          <Text numberOfLines={1} className="text-sm text-muted">
            {[
              book.author,
              book.source === 'addon' ? (book.downloaded ? t('Downloaded') : t('Streaming')) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {progress > 0 && book.finishedAt === null && !book.missing && (
          <View className="h-1 overflow-hidden rounded-full bg-line">
            <View style={{ width: `${progress * 100}%` }} className="h-1 bg-amber" />
          </View>
        )}
      </View>
      <Text className={`text-sm ${book.finishedAt !== null ? 'text-amber' : 'text-muted'}`}>
        {unavailable ? t('Not on this phone') : status(book)}
      </Text>
      {/* A mouse can't long-press comfortably, so the web shows the menu as a button. */}
      {Platform.OS === 'web' && (
        <IconButton
          name="more"
          label={t('More for {name}', { name: book.title })}
          size={20}
          color={COLORS.muted}
          onPress={() => onLongPress(book)}
        />
      )}
    </Pressable>
  );
});

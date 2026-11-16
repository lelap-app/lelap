import type { LibraryBook } from '@lelap/core';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BookCover } from './BookCover';

function status(book: LibraryBook): string {
  if (book.missing) return 'Files not found';
  if (book.finishedAt !== null) return '✓ Finished';
  if (book.bookPositionMs <= 0) return 'New';
  if (book.durationMs <= 0) return 'Started';
  return `${Math.min(99, Math.floor((book.bookPositionMs / book.durationMs) * 100))} %`;
}

export const BookRow = memo(function BookRow({
  book,
  onOpen,
  onToggleFinished,
}: {
  book: LibraryBook;
  onOpen: (book: LibraryBook) => void;
  onToggleFinished: (book: LibraryBook) => void;
}) {
  const progress = book.durationMs > 0 ? Math.min(1, book.bookPositionMs / book.durationMs) : 0;
  return (
    <Pressable
      onPress={() => onOpen(book)}
      onLongPress={() => onToggleFinished(book)}
      className={`flex-row items-center gap-3 px-4 py-2 active:bg-raised ${book.missing ? 'opacity-40' : ''}`}
    >
      <BookCover path={book.coverPath} title={book.title} size={56} />
      <View className="flex-1 gap-1">
        <Text numberOfLines={2} className="text-base text-paper">
          {book.title}
        </Text>
        {book.author !== null && (
          <Text numberOfLines={1} className="text-sm text-muted">
            {book.author}
          </Text>
        )}
        {progress > 0 && book.finishedAt === null && !book.missing && (
          <View className="h-1 overflow-hidden rounded-full bg-line">
            <View style={{ width: `${progress * 100}%` }} className="h-1 bg-amber" />
          </View>
        )}
      </View>
      <Text className={`text-sm ${book.finishedAt !== null ? 'text-amber' : 'text-muted'}`}>
        {status(book)}
      </Text>
    </Pressable>
  );
});

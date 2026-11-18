import { chapterTitleAt, type LibraryBook } from '@lelap/core';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { hint } from '../a11y';
import { t } from '../i18n';
import { COLORS, Icon } from './Icon';
import { formatLeft } from '../format';
import { BookCover, coverUri } from './BookCover';
import { db } from '../db';
import { useLibrary } from '../player';

export function ContinueCard({ book, onPress }: { book: LibraryBook; onPress: () => void }) {
  const { version } = useLibrary();
  // `version` is the signal to re-read the database: chapters found from silences arrive later.
  const chapter = useMemo(
    () => chapterTitleAt(db, book.id, book.bookPositionMs),
    [book.id, book.bookPositionMs, version],
  );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...hint(t('Plays from where you stopped'))}
      className="mx-4 flex-row items-center gap-4 rounded-xl bg-raised p-3 active:opacity-80"
    >
      <BookCover uri={coverUri(book)} title={book.title} size={72} />
      <View className="flex-1 gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted">
          {t('Continue listening')}
        </Text>
        <Text numberOfLines={2} className="text-base font-semibold text-paper">
          {book.title}
        </Text>
        {chapter !== null && (
          <Text numberOfLines={1} className="text-sm text-soft">
            {chapter}
          </Text>
        )}
        {book.durationMs > 0 && (
          <Text className="text-sm text-soft">
            {formatLeft(book.durationMs - book.bookPositionMs)}
          </Text>
        )}
      </View>
      <View className="h-12 w-12 items-center justify-center rounded-full bg-amber">
        <Icon name="play" size={22} color={COLORS.ink} />
      </View>
    </Pressable>
  );
}

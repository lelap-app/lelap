import type { Series } from '@lelap/core';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { Icon } from './Icon';
import { useColors } from '../theme';

/** A series in the Library's Series view (M109): its first cover, name, author and count. */
export const SeriesRow = memo(function SeriesRow({
  series,
  onOpen,
}: {
  series: Series;
  onOpen: (series: Series) => void;
}) {
  const colors = useColors();
  const first = series.books[0]?.book;
  const count = series.books.length;
  const finished = series.books.filter((b) => b.book.finishedAt !== null).length;
  const line = [
    series.author,
    count === 1 ? t('1 book') : t('{n} books', { n: count }),
    finished > 0 ? t('{n} finished', { n: finished }) : null,
    series.missing.length === 1
      ? t('1 missing')
      : series.missing.length > 1
        ? t('{n} missing', { n: series.missing.length })
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => onOpen(series)}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
    >
      {/* A second cover peeks out behind the first, so a series reads as more than one book. */}
      <View className="h-14 w-16 justify-center">
        {count > 1 && (
          <View className="absolute end-0 top-1 h-12 w-12 rounded-md bg-line opacity-70" />
        )}
        {first && <BookCover uri={coverUri(first)} title={series.name} size={56} />}
      </View>
      <View className="flex-1 gap-1">
        <Text numberOfLines={2} className="text-base text-paper">
          {series.name}
        </Text>
        <Text numberOfLines={2} className="text-sm text-muted">
          {line}
        </Text>
      </View>
      <Icon name="forward" size={20} color={colors.muted} />
    </Pressable>
  );
});

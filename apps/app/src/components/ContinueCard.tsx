import type { LibraryBook } from '@lelap/core';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { COLORS, Icon } from './Icon';
import { formatLeft } from '../format';
import { BookCover, coverUri } from './BookCover';
import { useBookBadges } from './CoverBadges';

export function ContinueCard({ book, onPress }: { book: LibraryBook; onPress: () => void }) {
  // Screen readers hear the time left instead.
  const badges = useBookBadges(book, 72);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={t('Plays from where you stopped')}
      className="mx-4 flex-row items-center gap-4 rounded-xl bg-raised p-3 active:opacity-80"
    >
      <BookCover uri={coverUri(book)} title={book.title} size={72} badges={badges} />
      <View className="flex-1 gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted">
          {t('Continue listening')}
        </Text>
        <Text numberOfLines={2} className="text-base font-semibold text-paper">
          {book.title}
        </Text>
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

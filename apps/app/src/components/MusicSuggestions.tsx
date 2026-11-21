import type { LibraryBook } from '@lelap/core';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { formatDuration } from '../format';
import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { Icon, IconButton } from './Icon';
import { Sheet } from './Sheet';
import { TextButton } from './TextButton';
import { useColors } from '../theme';

/** The card at the top of the Library when some items look like music (M77). */
export function MusicCard({
  count,
  onReview,
  onDismiss,
}: {
  count: number;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  return (
    <View className="mx-4 flex-row items-center gap-3 rounded-xl bg-raised py-1 pe-1 ps-4">
      <Icon name="sound" size={22} color={colors.soft} />
      <Text className="flex-1 text-paper">
        {count === 1
          ? t('1 item looks like music.')
          : t('{n} items look like music.', { n: count })}
      </Text>
      <TextButton text={t('Review')} onPress={onReview} />
      <IconButton
        name="close"
        label={t('Not music')}
        size={20}
        color={colors.muted}
        onPress={onDismiss}
      />
    </View>
  );
}

/**
 * The items that look like music, each ticked. “Hide selected” hides the ticked ones; the rest
 * are kept as not music and never suggested again.
 */
export function MusicReview({
  books,
  onClose,
  onHide,
}: {
  /** Null hides the sheet. */
  books: LibraryBook[] | null;
  onClose: () => void;
  onHide: (hide: LibraryBook[], keep: LibraryBook[]) => void;
}) {
  const colors = useColors();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  useEffect(() => setTicked(new Set(books?.map((b) => b.id))), [books]);
  if (!books) return null;
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  };
  return (
    <Sheet visible title={t('Looks like music')} onClose={onClose}>
      <Text className="px-2 pb-2 text-detail text-muted">
        {t('Nothing is deleted. Find hidden items under Hidden in the Library.')}
      </Text>
      <ScrollView>
        {books.map((book) => {
          const on = ticked.has(book.id);
          return (
            <Pressable
              key={book.id}
              onPress={() => toggle(book.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              aria-checked={on}
              className="min-h-12 flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-line"
            >
              <BookCover uri={coverUri(book)} title={book.title} size={40} />
              <View className="flex-1">
                <Text numberOfLines={2} className="text-paper">
                  {book.title}
                </Text>
                <Text numberOfLines={1} className="text-caption text-muted">
                  {[book.author, book.durationMs > 0 ? formatDuration(book.durationMs) : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View
                className={`h-6 w-6 items-center justify-center rounded border ${on ? 'border-amber bg-amber' : 'border-line'}`}
              >
                {on && <Icon name="check" size={18} color={colors.ink} />}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View className="flex-row justify-end gap-2 pt-2">
        <TextButton text={t('Cancel')} tone="muted" onPress={onClose} />
        <TextButton
          text={t('Hide selected')}
          onPress={() =>
            onHide(
              books.filter((b) => ticked.has(b.id)),
              books.filter((b) => !ticked.has(b.id)),
            )
          }
        />
      </View>
    </Sheet>
  );
}

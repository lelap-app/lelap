import { bookFraction, type LibraryBook } from '@lelap/core';
import { memo } from 'react';
import {
  type AccessibilityActionEvent,
  Animated,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';

import { deleteKeyAction } from '../a11y';
import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { useBookBadges } from './CoverBadges';
import { IconButton, type IconName } from './Icon';
import { SwipeBackdrop, useRowSwipe } from './RowSwipe';
import { ROW_BUTTON } from './TextButton';
import { Draggable } from '../drag';
import { useColors } from '../theme';

/** What swiping a row to the left does, such as Hide; also offered to TalkBack as an action. */
export type RowSwipe = {
  label: string;
  icon: IconName;
  onSwipe: (book: LibraryBook) => void;
};

function status(book: LibraryBook): string {
  if (book.missing) return t('Files not found');
  if (book.finishedAt !== null) return t('✓ Finished');
  // A book shown as a podcast: its episodes say more than its one place (M158).
  if (book.episodes) {
    return book.episodes.left === 1
      ? t('1 episode left')
      : t('{n} episodes left', { n: book.episodes.left });
  }
  if (book.bookPositionMs <= 0) return t('New');
  // Parts without lengths yet (M152) count by parts.
  if (book.durationMs <= 0 && !(book.partsDone && book.partsDone > 0)) return t('Started');
  return `${Math.min(99, Math.floor(bookFraction(book) * 100))} %`;
}

export const BookRow = memo(function BookRow({
  book,
  onOpen,
  onLongPress,
  swipe,
  unavailable = false,
  note,
}: {
  book: LibraryBook;
  /** Said first on the second line, such as the book's number in a series. */
  note?: string;
  /** Offline and not downloaded: shown dimmed. */
  unavailable?: boolean;
  onOpen: (book: LibraryBook) => void;
  onLongPress: (book: LibraryBook) => void;
  swipe?: RowSwipe;
}) {
  const colors = useColors();
  const progress = bookFraction(book);
  const dim = book.missing || unavailable;
  // The row shows progress as a bar and a percent already; screen readers read its words.
  const badges = useBookBadges(book, 56).filter((b) => b.kind !== 'progress');
  const { x, width, handlers, justSwiped } = useRowSwipe(swipe ? () => swipe.onSwipe(book) : null);
  // A swipe can't be done with TalkBack, so the same thing is one of the row's actions.
  const actions = swipe ? { accessibilityActions: [{ name: 'swipe', label: swipe.label }] } : {};
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'swipe') swipe?.onSwipe(book);
  };
  return (
    // The row can be dragged onto a list: with a mouse on the web (M113), held on a tablet (M120).
    <Draggable item={{ kind: 'book', id: book.id }} label={book.title}>
      <View onLayout={(e) => (width.current = e.nativeEvent.layout.width)}>
        {swipe && <SwipeBackdrop x={x} icon={swipe.icon} label={swipe.label} />}
        <Animated.View style={{ transform: [{ translateX: x }] }} {...handlers}>
          <Pressable
            onPress={() => {
              if (!justSwiped()) onOpen(book);
            }}
            onLongPress={() => onLongPress(book)}
            {...ROW_BUTTON}
            {...actions}
            onAccessibilityAction={onAction}
            {...deleteKeyAction(swipe?.label, () => swipe?.onSwipe(book))}
            className="flex-row items-center gap-3 bg-night px-4 py-2 active:bg-raised"
          >
            {/* A book that can't play here is dimmed by colour, not opacity, so its text stays readable. */}
            <View className={dim ? 'opacity-40' : ''}>
              <BookCover uri={coverUri(book)} title={book.title} size={56} badges={badges} />
            </View>
            <View className="flex-1 gap-1">
              <Text numberOfLines={2} className={`text-body ${dim ? 'text-muted' : 'text-paper'}`}>
                {book.title}
              </Text>
              {(book.author !== null || book.source === 'addon' || note) && (
                <Text numberOfLines={1} className="text-detail text-muted">
                  {[
                    note,
                    book.author,
                    book.source === 'addon'
                      ? book.downloaded
                        ? t('Downloaded')
                        : t('Streaming')
                      : null,
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
            <Text
              className={`text-detail ${book.finishedAt !== null ? 'text-amber' : 'text-muted'}`}
            >
              {unavailable ? t('Needs a connection') : status(book)}
            </Text>
            {/* A mouse can't long-press comfortably, so the web shows the menu as a button. */}
            {Platform.OS === 'web' && (
              <IconButton
                name="more"
                label={t('More for {name}', { name: book.title })}
                size={20}
                color={colors.muted}
                onPress={() => onLongPress(book)}
              />
            )}
          </Pressable>
        </Animated.View>
      </View>
    </Draggable>
  );
});

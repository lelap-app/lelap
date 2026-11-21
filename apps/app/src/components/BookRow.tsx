import { bookFraction, type LibraryBook } from '@lelap/core';
import { memo, useMemo, useRef } from 'react';
import {
  type AccessibilityActionEvent,
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { deleteKeyAction } from '../a11y';
import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { useBookBadges } from './CoverBadges';
import { Icon, IconButton, type IconName } from './Icon';
import { ROW_BUTTON } from './TextButton';
import { Draggable } from '../drag';
import { useColors } from '../theme';

/** What swiping a row to the left does, such as Hide; also offered to TalkBack as an action. */
export type RowSwipe = {
  label: string;
  icon: IconName;
  onSwipe: (book: LibraryBook) => void;
};

/** A swipe this far across the row, or a quick flick, does it; anything less springs back. */
const SWIPE_SHARE = 0.35;
const FLICK = -0.8;
const DRIVER = Platform.OS !== 'web';

function status(book: LibraryBook): string {
  if (book.missing) return t('Files not found');
  if (book.finishedAt !== null) return t('✓ Finished');
  if (book.bookPositionMs <= 0) return t('New');
  // Parts without lengths yet (M152) count by parts.
  if (book.durationMs <= 0 && !(book.partsDone && book.partsDone > 0)) return t('Started');
  return `${Math.min(99, Math.floor(bookFraction(book) * 100))} %`;
}

function useSwipe(book: LibraryBook, swipe: RowSwipe | undefined) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  // A browser still clicks the row when a mouse drag ends on it; that click is not a tap.
  const swipedAt = useRef(0);
  const handlers = useMemo(() => {
    if (!swipe) return {};
    const back = () =>
      Animated.spring(x, { toValue: 0, bounciness: 4, useNativeDriver: DRIVER }).start();
    return PanResponder.create({
      // Only a clearly sideways move to the left; anything else stays the list's scroll.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => (swipedAt.current = Date.now()),
      onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (_, g) => {
        swipedAt.current = Date.now();
        if (-g.dx < width.current * SWIPE_SHARE && g.vx > FLICK) return back();
        Animated.timing(x, {
          toValue: -width.current,
          duration: 150,
          useNativeDriver: DRIVER,
        }).start(() => {
          swipe.onSwipe(book);
          // The row is gone by then; should it stay (nothing was hidden), it comes back.
          setTimeout(() => x.setValue(0), 400);
        });
      },
      onPanResponderTerminate: back,
    }).panHandlers;
  }, [book, swipe, x]);
  const justSwiped = () => Date.now() - swipedAt.current < 500;
  return { x, width, handlers, justSwiped };
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
  /** Offline and not on this phone: shown dimmed. */
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
  const { x, width, handlers, justSwiped } = useSwipe(book, swipe);
  // A swipe can't be done with TalkBack, so the same thing is one of the row's actions.
  const actions = swipe ? { accessibilityActions: [{ name: 'swipe', label: swipe.label }] } : {};
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'swipe') swipe?.onSwipe(book);
  };
  return (
    // The row can be dragged onto a list: with a mouse on the web (M113), held on a tablet (M120).
    <Draggable item={{ kind: 'book', id: book.id }} label={book.title}>
      <View onLayout={(e) => (width.current = e.nativeEvent.layout.width)}>
        {swipe && (
          // Shown only while the row moves, so no edge of it shows between rows at rest.
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: x.interpolate({
                  inputRange: [-1, 0],
                  outputRange: [1, 0],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <View className="flex-1 flex-row items-center justify-end gap-2 bg-amber px-6">
              <Icon name={swipe.icon} size={20} color={colors.ink} />
              <Text className="font-semibold text-ink">{swipe.label}</Text>
            </View>
          </Animated.View>
        )}
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
              {unavailable ? t('Not on this phone') : status(book)}
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

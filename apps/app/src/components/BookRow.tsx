import type { LibraryBook } from '@lelap/core';
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

import { t } from '../i18n';
import { BookCover, coverUri } from './BookCover';
import { useBookBadges } from './CoverBadges';
import { COLORS, Icon, IconButton, type IconName } from './Icon';
import { ROW_BUTTON } from './TextButton';

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
  if (book.durationMs <= 0) return t('Started');
  return `${Math.min(99, Math.floor((book.bookPositionMs / book.durationMs) * 100))} %`;
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
}: {
  book: LibraryBook;
  /** Offline and not on this phone: shown dimmed. */
  unavailable?: boolean;
  onOpen: (book: LibraryBook) => void;
  onLongPress: (book: LibraryBook) => void;
  swipe?: RowSwipe;
}) {
  const progress = book.durationMs > 0 ? Math.min(1, book.bookPositionMs / book.durationMs) : 0;
  // The row shows progress as a bar and a percent already; screen readers read its words.
  const badges = useBookBadges(book, 56).filter((b) => b.kind !== 'progress');
  const { x, width, handlers, justSwiped } = useSwipe(book, swipe);
  // A swipe can't be done with TalkBack, so the same thing is one of the row's actions.
  const actions = swipe ? { accessibilityActions: [{ name: 'swipe', label: swipe.label }] } : {};
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'swipe') swipe?.onSwipe(book);
  };
  return (
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
            <Icon name={swipe.icon} size={20} color={COLORS.ink} />
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
          className={`flex-row items-center gap-3 bg-night px-4 py-2 active:bg-raised ${book.missing || unavailable ? 'opacity-40' : ''}`}
        >
          <BookCover uri={coverUri(book)} title={book.title} size={56} badges={badges} />
          <View className="flex-1 gap-1">
            <Text numberOfLines={2} className="text-base text-paper">
              {book.title}
            </Text>
            {(book.author !== null || book.source === 'addon') && (
              <Text numberOfLines={1} className="text-sm text-muted">
                {[
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
      </Animated.View>
    </View>
  );
});

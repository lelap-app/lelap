import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../theme';
import { Icon, type IconName } from './Icon';

/** A swipe this far across the row, or a quick flick, does it; anything less springs back. */
const SWIPE_SHARE = 0.35;
const FLICK = -0.8;
const DRIVER = Platform.OS !== 'web';

/**
 * A row that does something when swiped to the left, such as Hide in the Library or marking an
 * episode played (M158). Null `onSwipe` turns it off. Put `handlers` and `x` on the row's
 * `Animated.View`, `width` on its outer view, and ask `justSwiped` before a tap opens anything.
 */
export function useRowSwipe(onSwipe: (() => void) | null) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  // A browser still clicks the row when a mouse drag ends on it; that click is not a tap.
  const swipedAt = useRef(0);
  const run = useRef(onSwipe);
  run.current = onSwipe;
  const enabled = onSwipe !== null;
  const handlers = useMemo(() => {
    if (!enabled) return {};
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
          run.current?.();
          // The row may be gone by then; should it stay, it comes back.
          setTimeout(() => x.setValue(0), 400);
        });
      },
      onPanResponderTerminate: back,
    }).panHandlers;
  }, [enabled, x]);
  const justSwiped = () => Date.now() - swipedAt.current < 500;
  return { x, width, handlers, justSwiped };
}

/** What shows behind a row while it is swiped: the action's icon and name. */
export function SwipeBackdrop({
  x,
  icon,
  label,
}: {
  x: Animated.Value;
  icon: IconName;
  label: string;
}) {
  const colors = useColors();
  return (
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
        <Icon name={icon} size={20} color={colors.ink} />
        <Text className="font-semibold text-ink">{label}</Text>
      </View>
    </Animated.View>
  );
}

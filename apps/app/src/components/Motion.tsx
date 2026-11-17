import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Small, quiet motion with React Native's own Animated, so it needs no extra setup on the web.
// Everything stands still when the system asks for reduced motion.

const DRIVER = Platform.OS !== 'web';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/** Fades and lifts its children in once, when `show` turns true (on mount by default). */
export function FadeIn({
  children,
  show = true,
  lift = 8,
  duration = 220,
  style,
}: {
  children: ReactNode;
  show?: boolean;
  lift?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!show) return;
    Animated.timing(progress, { toValue: 1, duration, useNativeDriver: DRIVER }).start();
  }, [show, duration, progress]);
  if (reduced) return <Animated.View style={style}>{children}</Animated.View>;
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A Pressable that gives a little under the finger. */
export function PressScale({
  children,
  style,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.spring(scale, { toValue: value, speed: 40, bounciness: 6, useNativeDriver: DRIVER });
  return (
    <Pressable
      {...props}
      onPressIn={(e) => {
        if (!reduced) to(0.92).start();
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) to(1).start();
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

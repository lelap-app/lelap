import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';

const THUMB = 24;
// A level grows left to right in every language, like the player's time line.
const LTR = { direction: 'ltr' } as const;

/**
 * A level in fixed steps, such as a volume. Tap or drag to choose; the choice is reported once, on
 * release. TalkBack reads the label and the value, and swiping up or down moves a step.
 */
export function LevelSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  const start = useRef(0);
  const latest = useRef({ min, max, step, onChange });
  latest.current = { min, max, step, onChange };

  const responder = useMemo(() => {
    const at = (x: number) => {
      const { min: lo, max: hi, step: by } = latest.current;
      const ratio = Math.min(1, Math.max(0, x / widthRef.current));
      return lo + Math.round((ratio * (hi - lo)) / by) * by;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Holds on to the finger, so the settings list doesn't scroll under a sideways drag.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        setHeld(at(start.current));
      },
      onPanResponderMove: (_, g) => setHeld(at(start.current + g.dx)),
      onPanResponderRelease: (_, g) => {
        setHeld(null);
        latest.current.onChange(at(start.current + g.dx));
      },
      onPanResponderTerminate: () => setHeld(null),
    });
  }, []);

  const shown = held ?? value;
  const ratio = (shown - min) / Math.max(1, max - min);
  const text = format(shown);

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-4">
        <Text className="text-body text-paper">{label}</Text>
        {/* The slider itself reads the value out, so this is for the eyes only. */}
        <Text
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          className={`text-body ${held === null ? 'text-soft' : 'font-semibold text-amber'}`}
        >
          {text}
        </Text>
      </View>
      <View
        {...responder.panHandlers}
        onLayout={(e) => {
          widthRef.current = Math.max(1, e.nativeEvent.layout.width);
          setWidth(widthRef.current);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: shown, text }}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        aria-valuetext={text}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const by = e.nativeEvent.actionName === 'increment' ? step : -step;
          const next = Math.min(max, Math.max(min, value + by));
          if (next !== value) onChange(next);
        }}
        style={LTR}
        className="h-12 justify-center"
      >
        <View pointerEvents="none" className="h-1.5 overflow-hidden rounded-full bg-line">
          <View style={{ width: `${ratio * 100}%` }} className="h-1.5 bg-amber" />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // layout: ltr
            left: ratio * width - THUMB / 2,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
          }}
          className="bg-paper"
        />
      </View>
    </View>
  );
}

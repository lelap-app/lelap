import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View } from 'react-native';

import { formatClock } from '../format';

const THUMB = 16;
const THUMB_DRAGGING = 24;
// After release, keep showing the drop point until the player reports the new position.
const SETTLE_MS = 800;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Progress over a range of the book (the chapter, or the whole book). Tap to jump; drag the
 * playhead to scrub with a live time, and the seek happens once, on release.
 */
export function Scrubber({
  elapsedMs,
  lengthMs,
  onSeek,
}: {
  elapsedMs: number;
  lengthMs: number;
  /** Offset into the range, in ms. */
  onSeek: (offsetMs: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const [held, setHeld] = useState<{ ratio: number; dragging: boolean } | null>(null);
  const widthRef = useRef(1);
  const grantX = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ lengthMs, onSeek });
  latest.current = { lengthMs, onSeek };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          if (settle.current) clearTimeout(settle.current);
          grantX.current = e.nativeEvent.locationX;
          setHeld({ ratio: clamp(grantX.current / widthRef.current), dragging: true });
        },
        onPanResponderMove: (_, g) =>
          setHeld({ ratio: clamp((grantX.current + g.dx) / widthRef.current), dragging: true }),
        onPanResponderRelease: (_, g) => {
          const ratio = clamp((grantX.current + g.dx) / widthRef.current);
          latest.current.onSeek(ratio * latest.current.lengthMs);
          setHeld({ ratio, dragging: false });
          settle.current = setTimeout(() => setHeld(null), SETTLE_MS);
        },
        onPanResponderTerminate: () => setHeld(null),
      }),
    [],
  );

  const ratio = held ? held.ratio : clamp(elapsedMs / Math.max(1, lengthMs));
  const thumb = held?.dragging ? THUMB_DRAGGING : THUMB;

  return (
    <View className="gap-1">
      <View
        {...responder.panHandlers}
        onLayout={(e) => {
          widthRef.current = Math.max(1, e.nativeEvent.layout.width);
          setWidth(widthRef.current);
        }}
        className="h-10 justify-center"
      >
        <View pointerEvents="none" className="h-1.5 overflow-hidden rounded-full bg-line">
          <View style={{ width: `${ratio * 100}%` }} className="h-1.5 bg-amber" />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: ratio * width - thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
          }}
          className="bg-amber"
        />
      </View>
      <View className="flex-row justify-between">
        <Text className={`text-sm ${held?.dragging ? 'font-semibold text-amber' : 'text-muted'}`}>
          {formatClock(ratio * lengthMs)}
        </Text>
        <Text className="text-sm text-muted">-{formatClock((1 - ratio) * lengthMs)}</Text>
      </View>
    </View>
  );
}

import { SCRUB_RATE_LABELS, scrubRate, snapTo } from '@lelap/core';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, Text, Vibration, View } from 'react-native';

import { formatClock } from '../format';

const THUMB = 16;
const THUMB_DRAGGING = 24;
// After release, keep showing the drop point until the player reports the new position.
const SETTLE_MS = 800;
// Marks pull the playhead from this many points away.
const SNAP_POINTS = 10;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export type ScrubMark = {
  /** Offset into the range, in ms. */
  atMs: number;
  /** Bookmarks show as amber dots; chapter starts as small ticks. */
  kind: 'bookmark' | 'chapter';
};

/**
 * Progress over a range of the book (the chapter, or the whole book). Tap to jump; drag the
 * playhead to scrub with a live time, and the seek happens once, on release. Moving the finger up
 * away from the bar slows the playhead down for fine positioning; near a mark it snaps to it.
 */
export function Scrubber({
  elapsedMs,
  lengthMs,
  middle,
  marks = [],
  onSeek,
  onPressElapsed,
  onPressMiddle,
}: {
  elapsedMs: number;
  lengthMs: number;
  /** A note between the two times, such as progress in the whole book. */
  middle?: string | undefined;
  marks?: ScrubMark[];
  /** Offset into the range, in ms. */
  onSeek: (offsetMs: number) => void;
  /** Tapping the elapsed time, such as to type a time to jump to. */
  onPressElapsed?: (() => void) | undefined;
  /** Tapping the note in the middle, such as to switch between chapter and book. */
  onPressMiddle?: (() => void) | undefined;
}) {
  const [width, setWidth] = useState(1);
  const [held, setHeld] = useState<{
    ratio: number;
    dragging: boolean;
    rate: number;
    snapped: boolean;
  } | null>(null);
  const widthRef = useRef(1);
  const drag = useRef({ ratio: 0, lastDx: 0, snapped: false });
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ lengthMs, onSeek, marks });
  latest.current = { lengthMs, onSeek, marks };

  const responder = useMemo(() => {
    // Where the finger points, slowed down by its distance from the bar, then pulled to a mark.
    const follow = (dx: number, dy: number) => {
      const rate = scrubRate(dy);
      const state = drag.current;
      state.ratio = clamp(state.ratio + ((dx - state.lastDx) * rate) / widthRef.current);
      state.lastDx = dx;
      const { lengthMs: length, marks: list } = latest.current;
      const tolerance = (SNAP_POINTS / widthRef.current) * length * rate;
      const snap = snapTo(
        state.ratio * length,
        list.map((m) => m.atMs),
        tolerance,
      );
      const snapped = snap !== null;
      if (snapped && !state.snapped && Platform.OS !== 'web') Vibration.vibrate(8);
      state.snapped = snapped;
      return { ratio: snapped ? snap / Math.max(1, length) : state.ratio, rate, snapped };
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        if (settle.current) clearTimeout(settle.current);
        drag.current = {
          ratio: clamp(e.nativeEvent.locationX / widthRef.current),
          lastDx: 0,
          snapped: false,
        };
        setHeld({ ...follow(0, 0), dragging: true });
      },
      onPanResponderMove: (_, g) => setHeld({ ...follow(g.dx, g.dy), dragging: true }),
      onPanResponderRelease: (_, g) => {
        const { ratio } = follow(g.dx, g.dy);
        latest.current.onSeek(ratio * latest.current.lengthMs);
        setHeld({ ratio, dragging: false, rate: 1, snapped: false });
        settle.current = setTimeout(() => setHeld(null), SETTLE_MS);
      },
      onPanResponderTerminate: () => setHeld(null),
    });
  }, []);

  const ratio = held ? held.ratio : clamp(elapsedMs / Math.max(1, lengthMs));
  const thumb = held?.dragging ? THUMB_DRAGGING : THUMB;
  const length = Math.max(1, lengthMs);

  return (
    <View className="gap-1">
      {held?.dragging && held.rate < 1 && (
        <Text className="text-center text-xs font-semibold text-amber">
          {SCRUB_RATE_LABELS[held.rate]} scrubbing
        </Text>
      )}
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
        {marks.map((m) =>
          m.kind === 'chapter' ? (
            <View
              key={`c${m.atMs}`}
              pointerEvents="none"
              style={{ position: 'absolute', left: (m.atMs / length) * width - 1, top: 14 }}
              className="h-3 w-0.5 rounded-full bg-muted"
            />
          ) : (
            <View
              key={`b${m.atMs}`}
              pointerEvents="none"
              style={{ position: 'absolute', left: (m.atMs / length) * width - 4, top: 4 }}
              className="h-2 w-2 rounded-full bg-amber"
            />
          ),
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: ratio * width - thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
          }}
          className={held?.snapped ? 'bg-amber' : 'bg-paper'}
        />
      </View>
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={onPressElapsed}
          disabled={!onPressElapsed}
          hitSlop={8}
          accessibilityRole={onPressElapsed ? 'button' : 'text'}
          accessibilityHint={onPressElapsed ? 'Jump to a time' : undefined}
        >
          <Text
            className={`text-sm ${held?.dragging ? 'font-semibold text-amber' : 'text-muted'} ${onPressElapsed ? 'underline' : ''}`}
          >
            {formatClock(ratio * lengthMs)}
          </Text>
        </Pressable>
        {middle !== undefined && (
          <Pressable
            onPress={onPressMiddle}
            disabled={!onPressMiddle}
            hitSlop={8}
            accessibilityRole={onPressMiddle ? 'button' : 'text'}
          >
            <Text className="text-xs text-muted">{middle}</Text>
          </Pressable>
        )}
        <Text className="text-sm text-muted">-{formatClock((1 - ratio) * lengthMs)}</Text>
      </View>
    </View>
  );
}

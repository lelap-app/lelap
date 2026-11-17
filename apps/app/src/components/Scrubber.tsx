import { SCRUB_RATE_LABELS, scrubRate, snapTo } from '@lelap/core';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, Text, Vibration, View } from 'react-native';

import { t } from '../i18n';
import { formatClock } from '../format';

const THUMB = 16;
const THUMB_DRAGGING = 24;
// After release, keep showing the drop point until the player reports the new position.
const SETTLE_MS = 800;
// Marks pull the playhead from this many points away.
const SNAP_POINTS = 10;

const clamp = (n: number) => Math.min(1, Math.max(0, n));
// Swiping up or down with TalkBack moves a twentieth of the range, as Android's own seek bars do.
const STEP = 0.05;
// A time line runs left to right in every language, so the bar and its times are not mirrored.
const LTR = { direction: 'ltr' } as const;

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
  onDragChange,
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
  /** A drag starts or ends, so a scrolling parent can hold still meanwhile. */
  onDragChange?: ((dragging: boolean) => void) | undefined;
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
  const latest = useRef({ lengthMs, onSeek, marks, onDragChange });
  latest.current = { lengthMs, onSeek, marks, onDragChange };

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
        latest.current.onDragChange?.(true);
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
        latest.current.onDragChange?.(false);
        const { ratio } = follow(g.dx, g.dy);
        latest.current.onSeek(ratio * latest.current.lengthMs);
        setHeld({ ratio, dragging: false, rate: 1, snapped: false });
        settle.current = setTimeout(() => setHeld(null), SETTLE_MS);
      },
      onPanResponderTerminate: () => {
        latest.current.onDragChange?.(false);
        setHeld(null);
      },
    });
  }, []);

  const ratio = held ? held.ratio : clamp(elapsedMs / Math.max(1, lengthMs));
  const thumb = held?.dragging ? THUMB_DRAGGING : THUMB;
  const length = Math.max(1, lengthMs);

  return (
    <View className="gap-1">
      {held?.dragging && held.rate < 1 && (
        <Text className="text-center text-xs font-semibold text-amber">
          {t('{rate} scrubbing', { rate: SCRUB_RATE_LABELS[held.rate] ?? '' })}
        </Text>
      )}
      <View
        {...responder.panHandlers}
        onLayout={(e) => {
          widthRef.current = Math.max(1, e.nativeEvent.layout.width);
          setWidth(widthRef.current);
        }}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('Position')}
        // The aria- form, as react-native-web ignores accessibilityValue.
        aria-valuemin={0}
        aria-valuemax={Math.round(length / 1000)}
        aria-valuenow={Math.round((ratio * length) / 1000)}
        aria-valuetext={t('{time} of {total}', {
          time: formatClock(ratio * lengthMs),
          total: formatClock(lengthMs),
        })}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const by = e.nativeEvent.actionName === 'increment' ? STEP : -STEP;
          onSeek(clamp(ratio + by) * lengthMs);
        }}
        style={LTR}
        className="h-12 justify-center"
      >
        <View pointerEvents="none" className="h-1.5 overflow-hidden rounded-full bg-line">
          <View style={{ width: `${ratio * 100}%` }} className="h-1.5 bg-amber" />
        </View>
        {marks.map((m) =>
          m.kind === 'chapter' ? (
            <View
              key={`c${m.atMs}`}
              pointerEvents="none"
              style={{
                position: 'absolute',
                // layout: ltr
                left: (m.atMs / length) * width - 1,
                top: 18,
              }}
              className="h-3 w-0.5 rounded-full bg-muted"
            />
          ) : (
            <View
              key={`b${m.atMs}`}
              pointerEvents="none"
              style={{
                position: 'absolute',
                // layout: ltr
                left: (m.atMs / length) * width - 4,
                top: 8,
              }}
              className="h-2 w-2 rounded-full bg-amber"
            />
          ),
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // layout: ltr
            left: ratio * width - thumb / 2,
            width: thumb,
            height: thumb,
            borderRadius: thumb / 2,
          }}
          className={held?.snapped ? 'bg-amber' : 'bg-paper'}
        />
      </View>
      <View style={LTR} className="flex-row items-center justify-between gap-2">
        <Pressable
          onPress={onPressElapsed}
          disabled={!onPressElapsed}
          accessibilityRole={onPressElapsed ? 'button' : 'text'}
          className="min-h-12 justify-center"
          accessibilityHint={onPressElapsed ? t('Jump to a time') : undefined}
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
            accessibilityRole={onPressMiddle ? 'button' : 'text'}
            className="min-h-12 min-w-0 shrink items-center justify-center"
          >
            {/* Wraps between the two times when the text is large. */}
            <Text className="text-center text-xs text-muted">{middle}</Text>
          </Pressable>
        )}
        <Text className="text-sm text-muted">-{formatClock((1 - ratio) * lengthMs)}</Text>
      </View>
    </View>
  );
}

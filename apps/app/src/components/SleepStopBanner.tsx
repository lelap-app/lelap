import { sleepStopChoices } from '@lelap/core';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { formatTimeOfDay } from '../format';
import * as audio from '../platform/audio';
import { seekToBookPosition } from '../player';
import { TextButton } from './TextButton';

const clockOf = (ms: number): string => {
  const d = new Date(ms);
  return formatTimeOfDay(d.getHours() * 60 + d.getMinutes());
};

/**
 * After the sleep timer stopped playback (M86): back to when the listener last used the player,
 * or a few minutes back. Lelap can't know when they fell asleep, so it never says; it only knows
 * their last touch. Nothing moves until they pick, and the offer goes once they play on.
 */
export function SleepStopBanner({
  bookId,
  positionMs,
  playing,
  className = '',
}: {
  bookId: string;
  positionMs: number;
  playing: boolean;
  className?: string;
}) {
  const [stop, setStop] = useState<audio.SleepPlace | null>(null);

  // The service writes the stop when the timer pauses playback, so look again at every pause.
  useEffect(() => {
    let live = true;
    audio
      .getSleepPlace()
      .then((s) => live && setStop(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [bookId, playing]);

  const choices = sleepStopChoices(stop, bookId, positionMs, Date.now());
  if (stop === null || choices === null) return null;

  const close = () => {
    setStop(null);
    void audio.clearSleepPlace();
  };
  const goTo = (bookPositionMs: number) => {
    void seekToBookPosition(bookId, bookPositionMs);
    close();
  };
  const { lastUsed } = choices;

  return (
    <View
      accessibilityLiveRegion="polite"
      className={`gap-3 rounded-xl border border-line bg-raised px-4 py-3 ${className}`}
    >
      <Text className="text-sm text-soft">
        {t('The sleep timer stopped playback at {clock}.', { clock: clockOf(stop.stoppedAt) })}
      </Text>
      {lastUsed && (
        <Pressable
          onPress={() => goTo(lastUsed.positionMs)}
          accessibilityRole="button"
          className="min-h-12 justify-center rounded-lg bg-amber px-4 py-2 active:opacity-80"
        >
          <Text className="font-semibold text-ink">{t('Back to when you last used it')}</Text>
          <Text className="text-sm text-ink">
            {t('{clock}, {n} min before it stopped', {
              clock: clockOf(lastUsed.at),
              n: Math.round(lastUsed.beforeStopMs / 60_000),
            })}
          </Text>
        </Pressable>
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        {choices.back.map((b) => (
          <Pressable
            key={b.minutes}
            onPress={() => goTo(b.positionMs)}
            accessibilityRole="button"
            className="min-h-12 justify-center rounded-full border border-line px-4 active:bg-night"
          >
            <Text className="text-soft">{t('{n} min back', { n: b.minutes })}</Text>
          </Pressable>
        ))}
        <View className="flex-1" />
        <TextButton text={t('Not now')} tone="muted" onPress={close} />
      </View>
    </View>
  );
}

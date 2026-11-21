import {
  bookHistory,
  deviceValue,
  setDeviceValue,
  sleepStopChoices,
  sleepStopOf,
} from '@lelap/core';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { db } from '../db';
import { useHistoryVersion } from '../history';
import { t } from '../i18n';
import { formatTimeOfDay } from '../format';
import { seekToBookPosition } from '../player';
import { profileId } from '../profile';
import { Button } from './Button';
import { TextButton } from './TextButton';

const clockOf = (ms: number): string => {
  const d = new Date(ms);
  return formatTimeOfDay(d.getHours() * 60 + d.getMinutes());
};

/** The stop the listener answered with “Not now”, so it isn't offered again. */
const DISMISSED = 'sleepStopDismissed';

/**
 * After the sleep timer stopped playback (M86), read from the playback history (M138): back to when the listener last used the player,
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
  // The stop arrives with the history, also when the app wakes after the night; `version` and
  // `playing` are the signals to read it again.
  const version = useHistoryVersion();
  const [dismissed, setDismissed] = useState(() => deviceValue(db, DISMISSED));
  const stop = useMemo(
    () => sleepStopOf(bookHistory(db, profileId, bookId, Date.now())),
    [bookId, playing, version],
  );
  const key = stop ? `${profileId}:${stop.bookId}:${stop.stoppedAt}` : null;

  const choices = sleepStopChoices(stop, bookId, positionMs, Date.now());
  if (stop === null || choices === null || key === dismissed) return null;

  const close = () => {
    if (!key) return;
    setDismissed(key);
    setDeviceValue(db, DISMISSED, key, Date.now());
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
      <Text className="text-detail text-soft">
        {t('The sleep timer stopped playback at {clock}.', { clock: clockOf(stop.stoppedAt) })}
      </Text>
      {lastUsed && (
        <Pressable
          onPress={() => goTo(lastUsed.positionMs)}
          accessibilityRole="button"
          className="min-h-12 justify-center rounded-lg bg-amber px-4 py-2 active:opacity-80"
        >
          <Text className="font-semibold text-ink">{t('Back to when you last used it')}</Text>
          <Text className="text-detail text-ink">
            {t('{clock}, {n} min before it stopped', {
              clock: clockOf(lastUsed.at),
              n: Math.round(lastUsed.beforeStopMs / 60_000),
            })}
          </Text>
        </Pressable>
      )}
      <View className="flex-row flex-wrap items-center gap-2">
        {choices.back.map((b) => (
          <Button
            key={b.minutes}
            kind="secondary"
            size="sm"
            text={t('{n} min back', { n: b.minutes })}
            onPress={() => goTo(b.positionMs)}
          />
        ))}
        <View className="flex-1" />
        <TextButton text={t('Not now')} tone="muted" onPress={close} />
      </View>
    </View>
  );
}

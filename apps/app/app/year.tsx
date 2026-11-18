import { dayDate, yearInSoundFor } from '@lelap/core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type Svg from 'react-native-svg';

import { t } from '../src/i18n';
import { IconButton } from '../src/components/Icon';
import {
  Bars,
  CARD_HEIGHT,
  CARD_WIDTH,
  daysText,
  Figure,
  listenedText,
  SectionTitle,
  streakDates,
  useStatsPalette,
  YearCard,
} from '../src/components/Stats';
import { db } from '../src/db';
import { formatDayMonth, formatLongDate, formatMonth, formatNumber } from '../src/format';
import { shareImage } from '../src/platform/files';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';

/**
 * A year's overview (M87), worked out on this device. The picture is drawn here too and only
 * leaves the phone when the listener shares it.
 */
export default function YearScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useStatsPalette();
  const { width } = useWindowDimensions();
  const { version } = useLibrary();
  const params = useLocalSearchParams<{ year?: string }>();
  const yearNumber = Number(params.year) || new Date().getFullYear();
  const card = useRef<Svg>(null);
  const [sharing, setSharing] = useState(false);
  const [failed, setFailed] = useState(false);

  // `version` is the signal to re-read the database.
  const year = useMemo(() => yearInSoundFor(db, profileId, yearNumber), [version, yearNumber]);
  const title = t('{year} in sound', { year: String(yearNumber) });
  const cardWidth = Math.min(width - 32, 480);
  const busiestMonth = year.busiestMonth;

  const share = () => {
    const svg = card.current;
    if (!svg || sharing) return;
    setSharing(true);
    setFailed(false);
    // `toDataURL` never calls back when drawing fails, so give up after a while.
    new Promise<string>((resolve, reject) => {
      setTimeout(() => reject(new Error('The image took too long')), 10_000);
      svg.toDataURL(resolve, { width: CARD_WIDTH, height: CARD_HEIGHT });
    })
      .then((base64) => shareImage(`lelap-${yearNumber}.png`, base64))
      .catch(() => setFailed(true))
      .finally(() => setSharing(false));
  };

  return (
    <View style={{ backgroundColor: palette.background }} className="flex-1">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: insets.bottom + 24 }}
        className="px-4"
      >
        <View className="-ms-2 self-start">
          <IconButton
            name="back"
            label={t('Back')}
            color={palette.secondary}
            onPress={() => router.back()}
          />
        </View>
        <Text
          accessibilityRole="header"
          style={{ color: palette.text }}
          className="pb-4 text-3xl font-semibold"
        >
          {title}
        </Text>

        {year.ms === 0 && year.finished.length === 0 ? (
          <Text style={{ color: palette.secondary }}>
            {t('Nothing listened in {year} on this device.', { year: String(yearNumber) })}
          </Text>
        ) : (
          <>
            {/* The picture repeats the figures below, which a screen reader reads instead. */}
            <View
              aria-hidden
              importantForAccessibility="no-hide-descendants"
              style={{ borderColor: palette.border }}
              className="self-center overflow-hidden rounded-xl border"
            >
              <YearCard ref={card} year={year} palette={palette} width={cardWidth} />
            </View>
            <Pressable
              onPress={share}
              disabled={sharing}
              accessibilityRole="button"
              accessibilityState={{ busy: sharing }}
              style={{ backgroundColor: palette.accent, opacity: sharing ? 0.6 : 1 }}
              className="mt-4 min-h-12 items-center justify-center rounded-full px-5"
            >
              <Text style={{ color: palette.onAccent }} className="font-semibold">
                {t('Share as image')}
              </Text>
            </Pressable>
            <Text style={{ color: palette.secondary }} className="pt-2 text-xs">
              {failed
                ? t('The image could not be shared. Try again.')
                : t('The image is made on this device and only leaves it when you share it.')}
            </Text>

            <View className="flex-row gap-3 pt-6">
              <Figure palette={palette} label={t('Time listened')} value={listenedText(year.ms)} />
              <Figure
                palette={palette}
                label={t('Days listened')}
                value={formatNumber(year.daysListened)}
              />
            </View>
            <View className="flex-row gap-3 pt-3">
              <Figure
                palette={palette}
                label={t('Books finished')}
                value={formatNumber(year.finished.length)}
              />
              <Figure
                palette={palette}
                label={t('Books and episodes played')}
                value={formatNumber(year.booksPlayed)}
              />
            </View>
            <View className="flex-row gap-3 pt-3">
              <Figure
                palette={palette}
                label={t('Longest streak')}
                value={daysText(year.longestStreak?.days ?? 0)}
                {...(year.longestStreak && year.longestStreak.days > 1
                  ? { detail: streakDates(year.longestStreak, yearNumber) }
                  : {})}
              />
              <Figure
                palette={palette}
                label={t('Busiest day')}
                value={year.busiestDay ? formatDayMonth(dayDate(year.busiestDay.day)) : '–'}
                {...(year.busiestDay ? { detail: listenedText(year.busiestDay.ms) } : {})}
              />
            </View>

            <SectionTitle
              palette={palette}
              title={t('Month by month')}
              {...(busiestMonth !== null
                ? { count: t('Busiest: {month}', { month: formatMonth(busiestMonth, 'long') }) }
                : {})}
            />
            <Bars
              palette={palette}
              title={t('Time listened per month')}
              bars={year.months.map((ms, month) => ({
                key: String(month),
                label: formatMonth(month),
                spoken: formatMonth(month, 'long'),
                ms,
                current: month === busiestMonth,
              }))}
            />

            {year.finished.length > 0 && (
              <>
                <SectionTitle
                  palette={palette}
                  title={t('Finished')}
                  count={formatNumber(year.finished.length)}
                />
                {year.finished.map((b) => (
                  <View key={b.bookId} accessible className="flex-row items-center gap-3 py-2">
                    <Text numberOfLines={1} style={{ color: palette.text }} className="flex-1">
                      {b.title || t('Untitled')}
                    </Text>
                    <Text
                      accessibilityLabel={formatLongDate(dayDate(b.day))}
                      style={{ color: palette.secondary }}
                      className="text-sm"
                    >
                      {formatDayMonth(dayDate(b.day))}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {year.top.length > 0 && (
              <>
                <SectionTitle palette={palette} title={t('Most listened')} />
                {year.top.map((b, index) => (
                  <View key={b.bookId} accessible className="flex-row items-center gap-3 py-1">
                    <Text style={{ color: palette.secondary }} className="w-5">
                      {index + 1}
                    </Text>
                    <Text numberOfLines={1} style={{ color: palette.text }} className="flex-1">
                      {b.title || t('Untitled')}
                    </Text>
                    <Text style={{ color: palette.secondary }} className="text-sm">
                      {listenedText(b.ms)}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

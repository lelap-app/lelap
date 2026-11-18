import { dayDate, getSettings, listeningStats, setSetting } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { Icon, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { Sheet } from '../src/components/Sheet';
import {
  Bars,
  daysText,
  Figure,
  listenedText,
  SectionTitle,
  streakDates,
  useStatsPalette,
  useToday,
} from '../src/components/Stats';
import { db } from '../src/db';
import {
  formatDayMonth,
  formatLongDate,
  formatNumber,
  formatSpokenDay,
  formatWeekday,
  weekStartsOn,
} from '../src/format';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';

const GOALS = [0, 6, 12, 24, 36, 52];
// Finished books listed by title; the rest are counted.
const FINISHED_SHOWN = 8;

/** Listening time, streaks, finished books and the years. Computed and kept on this device. */
export default function StatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useStatsPalette();
  const { version, refresh } = useLibrary();
  const [choosingGoal, setChoosingGoal] = useState(false);
  const today = useToday();

  // `version` is the signal to re-read the database.
  const { stats, goal } = useMemo(
    () => ({
      stats: listeningStats(db, profileId, today, weekStartsOn()),
      goal: getSettings(db, profileId).yearlyGoalBooks,
    }),
    [version, today],
  );

  const thisWeek = stats.weeks[stats.weeks.length - 1];
  const finished = stats.finishedThisYear.length;
  const longest = stats.longestStreak;

  return (
    <View style={{ backgroundColor: palette.background }} className="flex-1">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 24 }}
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
          {t('Listening')}
        </Text>

        <View className="flex-row gap-3">
          <Figure palette={palette} label={t('Today')} value={listenedText(stats.todayMs)} />
          <Figure
            palette={palette}
            label={t('This week')}
            value={listenedText(thisWeek?.ms ?? 0)}
          />
        </View>
        <View className="flex-row gap-3 pt-3">
          <Figure palette={palette} label={t('This year')} value={listenedText(stats.yearMs)} />
          <Figure palette={palette} label={t('In all')} value={listenedText(stats.totalMs)} />
        </View>
        <View className="flex-row gap-3 pt-3">
          <Figure palette={palette} label={t('Streak')} value={daysText(stats.streak)} />
          <Figure
            palette={palette}
            label={t('Longest streak')}
            value={daysText(longest?.days ?? 0)}
            {...(longest && longest.days > 1
              ? { detail: streakDates(longest, new Date().getFullYear()) }
              : {})}
          />
        </View>

        <SectionTitle
          palette={palette}
          title={t('Last 7 days')}
          count={listenedText(stats.week.reduce((sum, d) => sum + d.ms, 0))}
        />
        <Bars
          palette={palette}
          title={t('Time listened per day')}
          bars={stats.week.map((d, index) => {
            const date = dayDate(d.day);
            return {
              key: d.day,
              label: formatWeekday(date),
              spoken: formatSpokenDay(date),
              ms: d.ms,
              current: index === stats.week.length - 1,
            };
          })}
        />

        <SectionTitle
          palette={palette}
          title={t('Last 8 weeks')}
          count={listenedText(stats.weeks.reduce((sum, w) => sum + w.ms, 0))}
        />
        <Bars
          palette={palette}
          title={t('Time listened per week')}
          bars={stats.weeks.map((w, index) => {
            const date = dayDate(w.start);
            return {
              key: w.start,
              label: formatDayMonth(date),
              spoken: t('Week of {date}', { date: formatLongDate(date) }),
              ms: w.ms,
              current: index === stats.weeks.length - 1,
            };
          })}
        />

        <Pressable
          onPress={() => setChoosingGoal(true)}
          accessibilityRole="button"
          accessibilityLabel={
            goal > 0
              ? t('Finished this year: {n} of {goal} books. Change goal', {
                  n: formatNumber(finished),
                  goal: formatNumber(goal),
                })
              : t('Finished this year: {n}. Set a goal', { n: formatNumber(finished) })
          }
          style={{ borderColor: palette.border }}
          className="mt-6 gap-2 rounded-xl border p-4"
        >
          <View className="flex-row items-baseline justify-between">
            <Text style={{ color: palette.text }} className="font-semibold">
              {t('Finished this year')}
            </Text>
            <Text style={{ color: palette.accentText }} className="text-sm">
              {goal > 0 ? t('Change goal') : t('Set a goal')}
            </Text>
          </View>
          <Text style={{ color: palette.text }} className="text-2xl font-semibold">
            {formatNumber(finished)}
            {goal > 0 && (
              <Text style={{ color: palette.secondary }} className="text-base">
                {' '}
                {t('of {n} books', { n: formatNumber(goal) })}
              </Text>
            )}
          </Text>
          {goal > 0 && (
            <View
              style={{ backgroundColor: palette.border }}
              className="h-1.5 overflow-hidden rounded-full"
            >
              <View
                style={{
                  width: `${Math.min(1, finished / goal) * 100}%`,
                  backgroundColor: palette.accent,
                }}
                className="h-1.5"
              />
            </View>
          )}
        </Pressable>
        {stats.finishedThisYear.slice(0, FINISHED_SHOWN).map((b) => (
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
        {finished > FINISHED_SHOWN && (
          <Text style={{ color: palette.secondary }} className="py-1 text-sm">
            {t('and {n} more', { n: formatNumber(finished - FINISHED_SHOWN) })}
          </Text>
        )}

        {stats.topThisYear.length > 0 && (
          <>
            <SectionTitle palette={palette} title={t('Most listened this year')} />
            {stats.topThisYear.map((b, index) => (
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

        {stats.years.length > 0 && (
          <>
            <SectionTitle palette={palette} title={t('Year in sound')} />
            {stats.years.map((year) => (
              <Pressable
                key={year}
                onPress={() => router.push({ pathname: '/year', params: { year: String(year) } })}
                accessibilityRole="button"
                accessibilityLabel={t('{year} in sound', { year: String(year) })}
                style={{ borderColor: palette.border }}
                className="mb-2 min-h-12 flex-row items-center justify-between rounded-xl border px-4 py-3"
              >
                <Text style={{ color: palette.text }} className="font-semibold">
                  {t('{year} in sound', { year: String(year) })}
                </Text>
                <Icon name="forward" size={20} color={palette.secondary} />
              </Pressable>
            ))}
          </>
        )}

        <Text style={{ color: palette.secondary }} className="pt-8 text-xs">
          {t(
            'Worked out on this device from what you play here. Never synced or sent anywhere, unless you share a year as an image.',
          )}
        </Text>
      </ScrollView>

      <Sheet
        visible={choosingGoal}
        title={t('Books to finish this year')}
        onClose={() => setChoosingGoal(false)}
      >
        <View className="flex-row flex-wrap gap-2 pb-2">
          {GOALS.map((n) => (
            <Pressable
              key={n}
              onPress={() => {
                setSetting(db, profileId, 'yearlyGoalBooks', n, Date.now());
                setChoosingGoal(false);
                refresh();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: n === goal }}
              aria-selected={n === goal}
              className={`min-h-12 justify-center rounded-full border px-4 ${n === goal ? 'border-amber bg-amber' : 'border-line'}`}
            >
              <Text className={n === goal ? 'text-ink' : 'text-soft'}>
                {n === 0 ? t('No goal') : n}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      <MiniPlayer />
    </View>
  );
}

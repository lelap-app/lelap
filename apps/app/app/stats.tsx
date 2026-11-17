import { dayKey, getSettings, listeningStats, setSetting } from '@lelap/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, IconButton } from '../src/components/Icon';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { Sheet } from '../src/components/Sheet';
import { db } from '../src/db';
import { useLibrary } from '../src/player';
import { profileId } from '../src/profile';

const GOALS = [0, 6, 12, 24, 36, 52];
const WEEKDAY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** “3 h 20 min”, “45 min”, “under 1 min”, “0 min”. */
function hours(ms: number): string {
  if (ms > 0 && ms < 60_000) return 'under 1 min';
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-xl bg-raised p-3">
      <Text className="text-xs uppercase tracking-wider text-muted">{label}</Text>
      <Text className="text-lg font-semibold text-paper">{value}</Text>
    </View>
  );
}

/** Listening time, streaks and the yearly goal. Computed and kept on this device. */
export default function StatsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const [choosingGoal, setChoosingGoal] = useState(false);

  // `version` is the signal to re-read the database.
  const { stats, goal } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    return {
      stats: listeningStats(
        db,
        profileId,
        dayKey(now),
        new Date(year, 0, 1).getTime(),
        new Date(year + 1, 0, 1).getTime(),
      ),
      goal: getSettings(db, profileId).yearlyGoalBooks,
    };
  }, [version]);

  const weekMs = stats.week.reduce((sum, d) => sum + d.ms, 0);
  const peak = Math.max(1, ...stats.week.map((d) => d.ms));

  return (
    <View className="flex-1 bg-night">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 24 }}
        className="px-4"
      >
        <View className="-ml-2 self-start">
          <IconButton name="back" label="Back" color={COLORS.soft} onPress={() => router.back()} />
        </View>
        <Text className="pb-4 text-3xl font-semibold text-paper">Listening</Text>

        <View className="flex-row gap-3">
          <Figure label="Today" value={hours(stats.todayMs)} />
          <Figure label="7 days" value={hours(weekMs)} />
        </View>
        <View className="flex-row gap-3 pt-3">
          <Figure label="This year" value={hours(stats.yearMs)} />
          <Figure
            label="Streak"
            value={
              stats.streak === 1
                ? '1 day'
                : `${stats.streak} days${stats.longestStreak > stats.streak ? ` · best ${stats.longestStreak}` : ''}`
            }
          />
        </View>

        <View
          accessible
          accessibilityLabel={`Last 7 days: ${stats.week.map((d) => hours(d.ms)).join(', ')}`}
          className="mt-6 h-36 flex-row items-end gap-2 rounded-xl bg-raised px-3 pb-2 pt-4"
        >
          {stats.week.map((d, index) => {
            const [y, m, day] = d.day.split('-').map(Number);
            const weekday = WEEKDAY[new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1).getDay()];
            const today = index === stats.week.length - 1;
            return (
              <View key={d.day} className="flex-1 items-center gap-1">
                <View className="w-full flex-1 justify-end">
                  <View
                    style={{ height: `${Math.max(2, (d.ms / peak) * 100)}%` }}
                    className={`w-full rounded-md ${today ? 'bg-amber' : 'bg-line'}`}
                  />
                </View>
                <Text className={`text-xs ${today ? 'text-amber' : 'text-muted'}`}>{weekday}</Text>
              </View>
            );
          })}
        </View>

        <Pressable
          onPress={() => setChoosingGoal(true)}
          accessibilityRole="button"
          className="mt-6 gap-2 rounded-xl border border-line p-4 active:bg-raised"
        >
          <View className="flex-row items-baseline justify-between">
            <Text className="font-semibold text-paper">Finished this year</Text>
            <Text className="text-sm text-amber">{goal > 0 ? 'Change goal' : 'Set a goal'}</Text>
          </View>
          <Text className="text-2xl font-semibold text-paper">
            {stats.finishedThisYear}
            {goal > 0 && <Text className="text-base text-muted"> of {goal} books</Text>}
          </Text>
          {goal > 0 && (
            <View className="h-1.5 overflow-hidden rounded-full bg-line">
              <View
                style={{ width: `${Math.min(1, stats.finishedThisYear / goal) * 100}%` }}
                className="h-1.5 bg-amber"
              />
            </View>
          )}
        </Pressable>

        {stats.topThisYear.length > 0 && (
          <View className="mt-6 gap-2">
            <Text className="text-xs uppercase tracking-wider text-muted">
              Most listened this year
            </Text>
            {stats.topThisYear.map((b, index) => (
              <View key={b.bookId} className="flex-row items-center gap-3 py-1">
                <Text className="w-5 text-muted">{index + 1}</Text>
                <Text numberOfLines={1} className="flex-1 text-paper">
                  {b.title || 'Untitled'}
                </Text>
                <Text className="text-sm text-soft">{hours(b.ms)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text className="pt-8 text-xs text-muted">
          Worked out on this device from what you play here. Never synced or sent anywhere. In all:{' '}
          {hours(stats.totalMs)}.
        </Text>
      </ScrollView>

      <Sheet
        visible={choosingGoal}
        title="Books to finish this year"
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
              className={`rounded-full border px-4 py-2 ${n === goal ? 'border-amber bg-amber' : 'border-line'}`}
            >
              <Text className={n === goal ? 'text-ink' : 'text-soft'}>
                {n === 0 ? 'No goal' : n}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
      <MiniPlayer />
    </View>
  );
}

import { chapterAt, getBook, toBookPosition } from '@lelap/core';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, Icon, type IconName } from '../src/components/Icon';
import { db } from '../src/db';
import { HeadphoneBanner } from '../src/devices';
import { formatClock } from '../src/format';
import * as audio from '../src/platform/audio';
import { seekToBookPosition, useLibrary, usePlayerState } from '../src/player';
import { profileId } from '../src/profile';

// Car mode (M33): five big targets on black, readable at a glance; the screen stays on. The sleep button steps like the
// notification's: 15 min → 30 min → end of chapter → off.

type SleepStep = 'off' | '15' | '30' | 'end';
const NEXT_STEP: Record<SleepStep, SleepStep> = { off: '15', '15': '30', '30': 'end', end: 'off' };

function BigButton({
  icon,
  label,
  caption,
  onPress,
  primary = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  caption: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const color = primary ? '#000000' : disabled ? COLORS.muted : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{ minHeight: 120 }}
      className={`flex-1 items-center justify-center gap-2 rounded-3xl border-2 ${
        primary ? 'border-amber bg-amber active:opacity-80' : 'border-[#5a5d66] active:bg-[#22252b]'
      }`}
    >
      <Icon name={icon} size={primary ? 64 : 48} color={color} />
      <Text style={{ color }} className="text-lg font-bold">
        {caption}
      </Text>
    </Pressable>
  );
}

export default function CarMode() {
  const state = usePlayerState();
  const { version } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The screen stays on while car mode is open, like a navigation app's.
  useKeepAwake();
  const [pressed, setPressed] = useState<SleepStep>('off');
  const bookId = state.bookId;
  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId, version]);

  const chapters = detail?.chapters ?? [];
  const position = detail
    ? toBookPosition(detail.files, state.fileLocation ?? '', state.positionMs)
    : 0;
  const current = chapterAt(chapters, position);
  const next = chapters[current + 1];
  const endMode = detail?.book.source === 'feed' ? 'episode' : 'chapter';

  const timer = state.sleepTimerRemainingMs;
  // A timer set elsewhere counts as the last step: the next press turns it off.
  const step: SleepStep = timer === null ? 'off' : pressed === 'off' ? 'end' : pressed;
  const cycleSleep = () => {
    const to = NEXT_STEP[step];
    setPressed(to);
    if (to === 'off') void audio.cancelSleepTimer();
    else if (to === 'end') void audio.startSleepTimerAtEnd(endMode);
    else void audio.startSleepTimer(Number(to));
  };

  return (
    <View
      style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
      className="flex-1 gap-4 bg-black px-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-2xl font-bold text-white">
            {detail?.book.title ?? 'Nothing is playing'}
          </Text>
          {chapters[current] && (
            <Text numberOfLines={1} className="text-lg text-[#d8d4cc]">
              {chapters[current].title}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Leave car mode"
          className="h-16 min-w-24 items-center justify-center rounded-2xl border-2 border-[#5a5d66] px-4 active:bg-[#22252b]"
        >
          <Text className="text-lg font-bold text-white">Exit</Text>
        </Pressable>
      </View>

      <HeadphoneBanner />

      <View className="flex-1 gap-4">
        <View className="flex-[2] flex-row gap-4">
          <BigButton
            icon="back30"
            label="Back 30 seconds"
            caption="Back"
            disabled={!bookId}
            onPress={() => void audio.skip(false)}
          />
          <BigButton
            icon={state.playing ? 'pause' : 'play'}
            label={state.playing ? 'Pause' : 'Play'}
            caption={state.playing ? 'Pause' : 'Play'}
            primary
            disabled={!bookId}
            onPress={() => void (state.playing ? audio.pause() : audio.play())}
          />
          <BigButton
            icon="forward30"
            label="Forward 30 seconds"
            caption="Forward"
            disabled={!bookId}
            onPress={() => void audio.skip(true)}
          />
        </View>
        <View className="flex-1 flex-row gap-4">
          <BigButton
            icon="next"
            label="Next chapter"
            caption="Next chapter"
            disabled={!bookId || !next}
            onPress={() => {
              if (bookId && next) void seekToBookPosition(bookId, next.startMs);
            }}
          />
          <BigButton
            icon="moon"
            label={timer === null ? 'Sleep timer off' : `Sleep timer, ${formatClock(timer)} left`}
            caption={timer === null ? 'Sleep' : formatClock(timer)}
            disabled={!bookId}
            onPress={cycleSleep}
          />
        </View>
      </View>
    </View>
  );
}

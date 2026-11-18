import { chapterAt, getBook, getSettings, toBookPosition } from '@lelap/core';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { BookCover, coverUri } from '../src/components/BookCover';
import { COLORS, Icon, type IconName } from '../src/components/Icon';
import { PressScale } from '../src/components/Motion';
import { db } from '../src/db';
import { HeadphoneBanner } from '../src/devices';
import { formatClock } from '../src/format';
import * as audio from '../src/platform/audio';
import { seekToBookPosition, useLibrary, usePlayerState } from '../src/player';
import { profileId } from '../src/profile';

// Car mode (M33, its look M74): the player's cover, title and chapter, big and calm, over five
// large targets; the screen stays on. Within Android's driving guidelines: no text under 18 points
// and five choices. Night by default, light when the phone is in light mode, for daylight. The
// sleep button steps like the notification's: 15 min → 30 min → end of chapter → off.

type SleepStep = 'off' | '15' | '30' | 'end';
const NEXT_STEP: Record<SleepStep, SleepStep> = { off: '15', '15': '30', '30': 'end', end: 'off' };

type Palette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  secondary: string;
  /** The chapter line: amber at night, a darker amber that reads on paper by day. */
  accentText: string;
  track: string;
  /** The place in the chapter, on [track]. */
  progress: string;
  disabled: string;
};

const NIGHT: Palette = {
  background: COLORS.night,
  surface: COLORS.raised,
  border: COLORS.line,
  text: COLORS.paper,
  secondary: COLORS.soft,
  accentText: COLORS.amber,
  track: COLORS.line,
  progress: COLORS.amber,
  disabled: '#5f5c56',
};

// Every text colour here is at least 5:1 on the paper and on the buttons. Amber on paper is too
// faint for the bar, so it takes the darker amber of the chapter line.
const DAY: Palette = {
  background: COLORS.paper,
  surface: '#e6e0d3',
  border: '#a89f8c',
  text: COLORS.ink,
  secondary: '#5c574d',
  accentText: '#7a4f00',
  track: '#d8d1c2',
  progress: '#7a4f00',
  disabled: '#a39d91',
};

// Sideways the screen is short, so the round buttons shrink a little; still twice Android's 48.
const PLAY_SIZE = { portrait: 128, landscape: 112 };
const SKIP_SIZE = { portrait: 96, landscape: 88 };

function RoundButton({
  icon,
  label,
  value,
  size,
  onPress,
  palette,
  primary = false,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  value?: string;
  size: number;
  onPress: () => void;
  palette: Palette;
  primary?: boolean;
  disabled?: boolean;
}) {
  const color = disabled ? palette.disabled : primary ? COLORS.ink : palette.text;
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary && !disabled ? COLORS.amber : palette.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: palette.border,
      }}
    >
      <Icon
        name={icon}
        size={Math.round(size * 0.45)}
        color={color}
        {...(value === undefined ? {} : { value })}
      />
    </PressScale>
  );
}

function WideButton({
  icon,
  label,
  caption,
  onPress,
  palette,
  disabled = false,
  active = false,
  height,
}: {
  icon: IconName;
  label: string;
  caption: string;
  onPress: () => void;
  palette: Palette;
  height: number;
  disabled?: boolean;
  /** A running sleep timer: the caption in the accent colour. */
  active?: boolean;
}) {
  const color = disabled ? palette.disabled : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: height,
        borderRadius: 24,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: palette.surface,
        borderWidth: 1,
        borderColor: palette.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={32} color={active && !disabled ? palette.accentText : color} />
      <Text
        numberOfLines={2}
        style={{
          color: active && !disabled ? palette.accentText : color,
          fontSize: 20,
          textAlign: 'center',
        }}
        className="font-bold"
      >
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
  const dims = useWindowDimensions();
  const palette = useColorScheme() === 'light' ? DAY : NIGHT;
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
  const chapter = chapters[current];
  const next = chapters[current + 1];
  const endMode = detail?.book.source === 'feed' ? 'episode' : 'chapter';

  // How far into the chapter, else the book; a glance, so no numbers.
  const from = chapter?.startMs ?? 0;
  const to = next?.startMs ?? detail?.book.durationMs ?? 0;
  const progress = to > from ? Math.min(1, Math.max(0, (position - from) / (to - from))) : 0;

  // `version` is the signal to re-read the setting.
  const skipSeconds = useMemo(() => getSettings(db, profileId).skipIntervalMs / 1000, [version]);
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

  const landscape = dims.width > dims.height;
  const shape = landscape ? 'landscape' : 'portrait';
  const height = dims.height - insets.top - insets.bottom;
  // What is left after the header, the text and the buttons; the cover takes it, within reason.
  // Portrait: the cover takes what the title and chapter leave of the middle, once measured, so
  // a headphone warning or large system text never pushes the buttons off the screen.
  const [middle, setMiddle] = useState<{ area: number; words: number } | null>(null);
  const portraitRoom = middle ? middle.area - middle.words - 24 : height - 556;
  const coverSize = Math.round(
    landscape
      ? Math.max(96, Math.min(height - 24, dims.width * 0.36, 360))
      : Math.max(64, Math.min(dims.width - 64, portraitRoom, 360)),
  );

  const exit = (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t('Leave car mode')}
      style={({ pressed: down }) => ({
        minHeight: 64,
        minWidth: 112,
        borderRadius: 32,
        paddingHorizontal: 24,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: down ? palette.surface : 'transparent',
      })}
    >
      <Text style={{ color: palette.text, fontSize: 20 }} className="font-bold">
        {t('Exit')}
      </Text>
    </Pressable>
  );

  const artwork = detail ? (
    <BookCover uri={coverUri(detail.book)} title={detail.book.title} size={coverSize} />
  ) : (
    <View
      aria-hidden
      style={{
        width: coverSize,
        height: coverSize,
        borderRadius: 16,
        backgroundColor: palette.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="car" size={Math.round(coverSize * 0.4)} color={palette.disabled} />
    </View>
  );

  const words = (
    <View className="gap-2" style={{ alignItems: landscape ? 'flex-start' : 'center' }}>
      <Text
        numberOfLines={landscape ? 1 : 2}
        style={{
          color: palette.text,
          fontSize: 28,
          lineHeight: 34,
          textAlign: landscape ? 'left' : 'center',
        }}
        className="font-bold"
      >
        {detail?.book.title ?? t('Nothing is playing')}
      </Text>
      {chapter || detail?.book.author ? (
        <Text
          numberOfLines={1}
          style={{
            color: chapter ? palette.accentText : palette.secondary,
            fontSize: 20,
            lineHeight: 26,
            textAlign: landscape ? 'left' : 'center',
          }}
          className="font-semibold"
        >
          {chapter?.title ?? detail?.book.author}
        </Text>
      ) : null}
      {detail && (
        <View
          aria-hidden
          style={{
            alignSelf: 'stretch',
            height: 6,
            borderRadius: 3,
            marginTop: 8,
            backgroundColor: palette.track,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${progress * 100}%`,
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.progress,
            }}
          />
        </View>
      )}
    </View>
  );

  const controls = (
    <View style={{ gap: landscape ? 16 : 24 }}>
      <View className="flex-row items-center justify-center gap-6">
        <RoundButton
          icon="skipBack"
          value={String(skipSeconds)}
          label={t('Back {n} seconds', { n: skipSeconds })}
          size={SKIP_SIZE[shape]}
          palette={palette}
          disabled={!bookId}
          onPress={() => void audio.skip(false)}
        />
        <RoundButton
          icon={state.playing ? 'pause' : 'play'}
          label={state.playing ? t('Pause') : t('Play')}
          size={PLAY_SIZE[shape]}
          palette={palette}
          primary
          disabled={!bookId}
          onPress={() => void (state.playing ? audio.pause() : audio.play())}
        />
        <RoundButton
          icon="skipForward"
          value={String(skipSeconds)}
          label={t('Forward {n} seconds', { n: skipSeconds })}
          size={SKIP_SIZE[shape]}
          palette={palette}
          disabled={!bookId}
          onPress={() => void audio.skip(true)}
        />
      </View>
      <View className="flex-row gap-4">
        <WideButton
          icon="next"
          label={t('Next chapter')}
          caption={t('Next chapter')}
          palette={palette}
          height={landscape ? 80 : 88}
          disabled={!bookId || !next}
          onPress={() => {
            if (bookId && next) void seekToBookPosition(bookId, next.startMs);
          }}
        />
        <WideButton
          icon="moon"
          label={
            timer === null
              ? t('Sleep timer off')
              : t('Sleep timer, {time} left', { time: formatClock(timer) })
          }
          caption={timer === null ? t('Sleep') : formatClock(timer)}
          palette={palette}
          height={landscape ? 80 : 88}
          active={timer !== null}
          disabled={!bookId}
          onPress={cycleSleep}
        />
      </View>
    </View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 16,
        // Sideways, the camera cut-out may be on either side.
        paddingHorizontal: Math.max(insets.left, insets.right) + 24,
        gap: 16,
      }}
    >
      {landscape ? (
        <View className="flex-1 flex-row items-center gap-8">
          {artwork}
          <View className="flex-1 justify-center gap-4">
            <View className="flex-row items-center gap-4">
              <View className="flex-1">{words}</View>
              {exit}
            </View>
            <HeadphoneBanner large />
            {controls}
          </View>
        </View>
      ) : (
        <View className="flex-1 justify-between gap-6">
          <View className="flex-row justify-end">{exit}</View>
          <HeadphoneBanner large />
          <View
            className="flex-1 items-center justify-center gap-6"
            onLayout={(e) => {
              const area = e.nativeEvent.layout.height;
              setMiddle((m) => (m?.area === area ? m : { area, words: m?.words ?? 0 }));
            }}
          >
            {artwork}
            <View
              style={{ alignSelf: 'stretch' }}
              onLayout={(e) => {
                const words = e.nativeEvent.layout.height;
                setMiddle((m) => (m?.words === words ? m : { area: m?.area ?? 0, words }));
              }}
            >
              {words}
            </View>
          </View>
          {controls}
        </View>
      )}
    </View>
  );
}

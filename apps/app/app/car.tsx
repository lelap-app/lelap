import {
  type CarPalette as Palette,
  chapterAt,
  chapterJump,
  getBook,
  getSettings,
  toBookPosition,
} from '@lelap/core';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { BookCover, coverUri } from '../src/components/BookCover';
import { Icon, type IconName } from '../src/components/Icon';
import { PressScale } from '../src/components/Motion';
import { db } from '../src/db';
import { HeadphoneBanner } from '../src/devices';
import { formatClock } from '../src/format';
import * as history from '../src/history';
import * as audio from '../src/platform/audio';
import { useSideways } from '../src/platform/orientation';
import {
  seekToBookPosition,
  stepList,
  useFollowedList,
  useLibrary,
  usePlayerState,
} from '../src/player';
import { profileId } from '../src/profile';
import { useCarPalette } from '../src/theme';

// Car mode (M33, its look M74): the player's cover, title and chapter, big and calm, over six
// large targets; the screen stays on. Within Android's driving guidelines: no text under 18 points
// and few choices: Previous chapter (M159) sits beside Next chapter, so the two read as one pair. Dark at night in the listener's theme, light by day when the phone is in light
// mode (M108). The sleep button steps like the notification's: 15 min → 30 min → end of chapter
// → off.

type SleepStep = 'off' | '15' | '30' | 'end';
const NEXT_STEP: Record<SleepStep, SleepStep> = { off: '15', '15': '30', '30': 'end', end: 'off' };

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
  const color = disabled ? palette.disabled : primary ? palette.onAccent : palette.text;
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
        backgroundColor: primary && !disabled ? palette.accent : palette.surface,
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
          textAlign: 'center',
        }}
        className="text-heading font-bold"
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
  const { palette, theme: carLook } = useCarPalette();
  // The screen stays on while car mode is open, like a navigation app's. Leaving before the
  // browser granted the wake lock throws on the web; there is nothing to release then.
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });
  // The rest of the app stays upright on phones; car mode may turn for a landscape holder.
  useSideways();
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
  // In the last chapter of a list's item (M112), the same button goes to the list's next item.
  const listNext = useFollowedList()?.next ?? null;
  const toListNext = !next && listNext !== null;

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
    void history.timer(() =>
      to === 'off'
        ? audio.cancelSleepTimer()
        : to === 'end'
          ? audio.startSleepTimerAtEnd(endMode)
          : audio.startSleepTimer(Number(to)),
    );
  };

  const landscape = dims.width > dims.height;
  const shape = landscape ? 'landscape' : 'portrait';
  const height = dims.height - insets.top - insets.bottom;
  // Sideways, the camera cut-out may be on either side.
  const side = Math.max(insets.left, insets.right) + 24;
  // Sideways (M107): the buttons keep a column of their own, the cover and chapter the rest.
  const controlsWidth = Math.round(Math.min(440, Math.max(300, (dims.width - 2 * side) * 0.46)));
  const pane = dims.width - 2 * side - controlsWidth - 40;
  // The cover takes what the title and chapter leave of its area, once measured, so a headphone
  // warning or large system text never pushes the buttons off the screen.
  const [middle, setMiddle] = useState<{ area: number; words: number } | null>(null);
  const room = middle
    ? middle.area - middle.words - (landscape ? 20 : 24)
    : height - (landscape ? 160 : 556);
  const coverSize = Math.round(
    landscape
      ? Math.max(96, Math.min(pane, room, 320))
      : Math.max(64, Math.min(dims.width - 64, room, 360)),
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
      <Text style={{ color: palette.text }} className="text-heading font-bold">
        {t('Exit')}
      </Text>
    </Pressable>
  );

  const cover = detail ? coverUri(detail.book) : null;
  // At night the cover's colours tint the whole screen, faintly, so it isn't a black box. At 18 %
  // even a white cover keeps the text at 5:1; by day the paper stays plain, and high contrast
  // puts no text over a picture.
  const backdrop =
    cover && carLook.dark && !carLook.highContrast ? (
      <Image
        aria-hidden
        source={{ uri: cover }}
        blurRadius={60}
        resizeMode="cover"
        style={{
          position: 'absolute',
          // Past the edges, so the blur has no visible border.
          top: -80,
          bottom: -80,
          start: -80,
          end: -80,
          opacity: 0.18,
        }}
      />
    ) : null;
  const artwork = detail ? (
    <BookCover uri={cover} title={detail.book.title} size={coverSize} />
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
    <View className="gap-2 items-center">
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        style={{
          color: palette.text,
          textAlign: 'center',
        }}
        className="text-title font-bold"
      >
        {detail?.book.title ?? t('Nothing is playing')}
      </Text>
      {chapter || detail?.book.author ? (
        <Text
          numberOfLines={1}
          style={{
            color: chapter ? palette.accentText : palette.secondary,
            textAlign: 'center',
          }}
          className="text-heading font-semibold"
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

  // A narrow screen (320 points, or large display size) shrinks the three round buttons to fit
  // side by side; at 320 the skips stay at 70, well above 48.
  const row = landscape ? controlsWidth : dims.width - 2 * side;
  const fit = Math.min(1, row / (PLAY_SIZE[shape] + 2 * SKIP_SIZE[shape] + 48));
  const playSize = Math.max(64, Math.round(PLAY_SIZE[shape] * fit));
  // Never under 48, even in a small split-screen window.
  const skipSize = Math.max(48, Math.round(SKIP_SIZE[shape] * fit));

  // Two rows of wide buttons under the round ones; sideways they stay short enough to fit.
  const wideHeight = landscape ? 64 : 80;
  const controls = (
    <View style={{ gap: landscape ? 12 : 20 }}>
      <View className="flex-row items-center justify-center gap-6">
        <RoundButton
          icon="skipBack"
          value={String(skipSeconds)}
          label={t('Back {n} seconds', { n: skipSeconds })}
          size={skipSize}
          palette={palette}
          disabled={!bookId}
          onPress={() => void history.skip(false)}
        />
        <RoundButton
          icon={state.playing ? 'pause' : 'play'}
          label={state.playing ? t('Pause') : t('Play')}
          size={playSize}
          palette={palette}
          primary
          disabled={!bookId}
          onPress={() => void history.playPause(state.playing)}
        />
        <RoundButton
          icon="skipForward"
          value={String(skipSeconds)}
          label={t('Forward {n} seconds', { n: skipSeconds })}
          size={skipSize}
          palette={palette}
          disabled={!bookId}
          onPress={() => void history.skip(true)}
        />
      </View>
      <View className="flex-row gap-4">
        <WideButton
          icon="previous"
          label={t('Previous chapter')}
          caption={t('Previous chapter')}
          palette={palette}
          height={wideHeight}
          disabled={!bookId || chapters.length === 0}
          onPress={() => {
            // As the player's button: the chapter's start, or the one before near its start.
            const to = chapterJump(chapters, position, false) ?? 0;
            if (bookId) void seekToBookPosition(bookId, to, 'chapter');
          }}
        />
        <WideButton
          icon="next"
          label={
            toListNext ? t('Next in list: {title}', { title: listNext.title }) : t('Next chapter')
          }
          caption={toListNext ? t('Next in list') : t('Next chapter')}
          palette={palette}
          height={wideHeight}
          disabled={!bookId || (!next && !toListNext)}
          onPress={() => {
            if (bookId && next) void seekToBookPosition(bookId, next.startMs, 'chapter');
            else if (toListNext) void stepList(true);
          }}
        />
      </View>
      <View className="flex-row gap-4">
        <WideButton
          icon="moon"
          label={
            timer === null
              ? t('Sleep timer off')
              : t('Sleep timer, {time} left', { time: formatClock(timer) })
          }
          caption={timer === null ? t('Sleep timer') : formatClock(timer)}
          palette={palette}
          height={wideHeight}
          active={timer !== null}
          disabled={!bookId}
          onPress={cycleSleep}
        />
      </View>
    </View>
  );

  // The cover above the title, chapter and bar, sized to what they leave.
  const nowPlaying = (
    <View
      className="flex-1 items-center justify-center"
      style={{ gap: landscape ? 20 : 24 }}
      onLayout={(e) => {
        const area = e.nativeEvent.layout.height;
        setMiddle((m) => (m?.area === area ? m : { area, words: m?.words ?? 0 }));
      }}
    >
      {artwork}
      <View
        style={
          landscape
            ? { alignSelf: 'center', width: Math.min(pane, coverSize + 160) }
            : { alignSelf: 'stretch' }
        }
        onLayout={(e) => {
          const words = e.nativeEvent.layout.height;
          setMiddle((m) => (m?.words === words ? m : { area: m?.area ?? 0, words }));
        }}
      >
        {words}
      </View>
    </View>
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingTop: insets.top + (landscape ? 16 : 8),
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: side,
        overflow: 'hidden',
      }}
    >
      {backdrop}
      {landscape ? (
        <View className="flex-1 flex-row" style={{ gap: 40 }}>
          <View className="flex-1 gap-4">
            <HeadphoneBanner large />
            {nowPlaying}
          </View>
          <View style={{ width: controlsWidth }} className="gap-4">
            <View className="flex-row justify-end">{exit}</View>
            <View className="flex-1 justify-center">{controls}</View>
          </View>
        </View>
      ) : (
        <View className="flex-1 justify-between gap-6">
          <View className="flex-row justify-end">{exit}</View>
          <HeadphoneBanner large />
          {nowPlaying}
          {controls}
        </View>
      )}
    </View>
  );
}

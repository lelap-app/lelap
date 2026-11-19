import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatTimeOfDay } from '../format';
import { t } from '../i18n';
import { READABLE, useWide } from '../layout';
import { useColors } from '../theme';
import { Icon, IconButton } from '../components/Icon';
import { MiniPlayer } from '../components/MiniPlayer';
import { Pill } from '../components/Pill';
import { RowLabel } from '../components/TextButton';

const DAY_MINUTES = 24 * 60;
// The bedtime window moves in half hours.
const BEDTIME_STEP = 30;

/** Settings and each of its pages (M133): Back, a heading, the rows and the mini player. */
export function SettingsPage({ title, children }: { title: string; children: ReactNode }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  return (
    <View className="flex-1 bg-night">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 24,
          ...(wide ? READABLE : {}),
        }}
      >
        <View className="-ms-2 self-start">
          <IconButton
            name="back"
            label={t('Back')}
            color={colors.soft}
            onPress={() => router.back()}
          />
        </View>
        <Text accessibilityRole="header" className="pb-4 text-3xl font-semibold text-paper">
          {title}
        </Text>
        {children}
      </ScrollView>
      <MiniPlayer />
    </View>
  );
}

/** A small heading over a few rows of a settings page. */
export function SectionHeader({ text }: { text: string }) {
  return (
    <Text accessibilityRole="header" className="pt-6 text-xs uppercase tracking-wider text-muted">
      {text}
    </Text>
  );
}

export function Choice({
  label,
  active,
  onPress,
  swatch,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /** A dot in this colour before the label, for an accent. */
  swatch?: string;
}) {
  return (
    <Pill
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      className={`flex-row items-center gap-2 rounded-full border px-4 py-2 ${active ? 'border-amber bg-amber' : 'border-line'}`}
    >
      {swatch !== undefined && (
        <View
          aria-hidden
          style={{ backgroundColor: swatch }}
          className={`h-3 w-3 rounded-full ${active ? 'border border-ink' : ''}`}
        />
      )}
      <Text className={active ? 'text-ink' : 'text-soft'}>{label}</Text>
    </Pill>
  );
}

export function Row({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <View className="flex-row items-center gap-4 border-b border-line py-4">
      <View className="flex-1 gap-1">
        <Text className="text-base text-paper">{label}</Text>
        {detail !== undefined && <Text className="text-sm text-muted">{detail}</Text>}
      </View>
      <RowLabel.Provider value={label}>{children}</RowLabel.Provider>
    </View>
  );
}

/** A line of the Settings list: a group's name over what it is set to now, opening its page. */
export function GroupLine({
  title,
  parts,
  onPress,
}: {
  title: string;
  /** What is set now, each part short; shown joined by dots. */
  parts: string[];
  onPress: () => void;
}) {
  const colors = useColors();
  const summary = parts.join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Commas, so a screen reader pauses between the parts instead of saying “dot”.
      accessibilityLabel={[title, ...parts].join(', ')}
      className="min-h-12 flex-row items-center gap-4 border-b border-line py-4 active:bg-raised"
    >
      <View className="flex-1 gap-1">
        <Text className="text-base text-paper">{title}</Text>
        {summary !== '' && <Text className="text-sm text-muted">{summary}</Text>}
      </View>
      <Icon name="forward" size={20} color={colors.muted} />
    </Pressable>
  );
}

/** A time of day with − and + buttons, half an hour per press. */
export function TimeStepper({
  label,
  minutes,
  onChange,
}: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
}) {
  const step = (by: number) => onChange((minutes + by + DAY_MINUTES) % DAY_MINUTES);
  return (
    <View className="flex-row items-center gap-3">
      <Text className="min-w-12 text-soft">{label}</Text>
      <Pressable
        onPress={() => step(-BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={t('{time}, 30 minutes earlier', { time: label })}
        className="h-12 w-12 items-center justify-center rounded-full border border-line active:bg-raised"
      >
        <Text maxFontSizeMultiplier={1.5} className="text-lg text-paper">
          −
        </Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" className="min-w-16 text-center text-lg text-paper">
        {formatTimeOfDay(minutes)}
      </Text>
      <Pressable
        onPress={() => step(BEDTIME_STEP)}
        accessibilityRole="button"
        accessibilityLabel={t('{time}, 30 minutes later', { time: label })}
        className="h-12 w-12 items-center justify-center rounded-full border border-line active:bg-raised"
      >
        <Text maxFontSizeMultiplier={1.5} className="text-lg text-paper">
          +
        </Text>
      </Pressable>
    </View>
  );
}

import { dayDate, dayKey, type StatsPalette, type Streak, type YearInSound } from '@lelap/core';
import { type Ref, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import {
  formatDayMonth,
  formatDuration,
  formatLongDate,
  formatMonth,
  formatNumber,
} from '../format';
import { t } from '../i18n';
import { useStatsPalette } from '../theme';

// Pieces of the Stats screen and the year overview (M87). Both draw in the app's theme (M108);
// charts are bars and counts, each with a text a screen reader reads.

export type { StatsPalette };
export { useStatsPalette };

/** Today as YYYY-MM-DD, moving on at midnight and when the app comes back. */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const check = () => setToday(dayKey(new Date()));
    const timer = setInterval(check, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  return today;
}

/** “3 h 20 min”, “45 min”, “under 1 min”, “0 min”. */
export function listenedText(ms: number): string {
  if (ms > 0 && ms < 60_000) return t('under 1 min');
  return formatDuration(ms);
}

/** `21 Oct to 4 Nov`, with the year for days outside [thisYear]. */
export function streakDates(streak: Streak, thisYear: number): string {
  const text = (day: string) =>
    Number(day.slice(0, 4)) === thisYear
      ? formatDayMonth(dayDate(day))
      : formatLongDate(dayDate(day));
  return t('{from} to {to}', { from: text(streak.from), to: text(streak.to) });
}

/** “1 day”, “12 days”. */
export const daysText = (n: number): string =>
  n === 1 ? t('1 day') : t('{n} days', { n: formatNumber(n) });

export function Figure({
  label,
  value,
  detail,
  palette,
}: {
  label: string;
  value: string;
  detail?: string;
  palette: StatsPalette;
}) {
  return (
    <View
      accessible
      style={{ backgroundColor: palette.surface }}
      className="flex-1 gap-1 rounded-xl p-3"
    >
      <Text style={{ color: palette.secondary }} className="text-xs uppercase tracking-wider">
        {label}
      </Text>
      <Text style={{ color: palette.text }} className="text-lg font-semibold">
        {value}
      </Text>
      {detail ? (
        <Text style={{ color: palette.secondary }} className="text-xs">
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionTitle({
  title,
  count,
  palette,
}: {
  title: string;
  count?: string;
  palette: StatsPalette;
}) {
  return (
    <View className="flex-row items-baseline justify-between gap-3 pb-2 pt-6">
      <Text
        accessibilityRole="header"
        style={{ color: palette.secondary }}
        className="text-xs uppercase tracking-wider"
      >
        {title}
      </Text>
      {count ? (
        <Text style={{ color: palette.text }} className="text-sm font-semibold">
          {count}
        </Text>
      ) : null}
    </View>
  );
}

export type Bar = {
  key: string;
  /** Under the bar: `Wed`, `9 Nov`, `Jan`. */
  label: string;
  /** What a screen reader says for it: `Wednesday 18 November`. */
  spoken: string;
  ms: number;
  current?: boolean;
};

/**
 * Bars of listening time. TalkBack reads the whole chart as one line, every bar with its time,
 * since a bar's height alone says nothing to it.
 */
export function Bars({
  title,
  bars,
  palette,
  height = 144,
}: {
  title: string;
  bars: Bar[];
  palette: StatsPalette;
  height?: number;
}) {
  const peak = Math.max(1, ...bars.map((b) => b.ms));
  const spoken = bars
    .map((b) => t('{when}: {time}', { when: b.spoken, time: listenedText(b.ms) }))
    .join('; ');
  return (
    <View
      accessible
      role="img"
      accessibilityLabel={`${title}. ${spoken}`}
      style={{ height, backgroundColor: palette.surface }}
      className="flex-row gap-1.5 rounded-xl px-3 pb-2 pt-4"
    >
      {bars.map((b) => (
        <View key={b.key} className="flex-1 items-center gap-1">
          <View className="w-full flex-1 justify-end">
            <View
              style={{
                height: b.ms > 0 ? `${Math.max(3, (b.ms / peak) * 100)}%` : 2,
                backgroundColor: b.current ? palette.accent : palette.bar,
                opacity: b.ms > 0 ? 1 : 0.5,
              }}
              className="w-full rounded-md"
            />
          </View>
          <Text
            numberOfLines={1}
            style={{ color: b.current ? palette.accentText : palette.secondary }}
            className={bars.length > 7 ? 'text-[10px]' : 'text-xs'}
          >
            {b.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// The shared image: 1080 × 1350, the shape photo apps and chats show whole.
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Whole hours from one hour up, minutes below. */
const roundTime = (ms: number) =>
  ms >= 3_600_000
    ? t('{n} h', { n: formatNumber(Math.round(ms / 3_600_000)) })
    : t('{n} min', { n: formatNumber(Math.round(ms / 60_000)) });

/**
 * The year as one picture, drawn here so it can be saved as a PNG on the device. It holds only
 * counts and the most listened title; nothing about the listener.
 */
export function YearCard({
  year,
  palette,
  width,
  ref,
}: {
  year: YearInSound;
  palette: StatsPalette;
  width: number;
  ref?: Ref<Svg>;
}) {
  const peak = Math.max(1, ...year.months);
  const left = 90;
  const chartTop = 800;
  const chartHeight = 280;
  const slot = (CARD_WIDTH - 2 * left) / 12;
  const counts = [
    { value: formatNumber(year.finished.length), label: t('Books finished') },
    { value: formatNumber(year.daysListened), label: t('Days listened') },
    { value: formatNumber(year.longestStreak?.days ?? 0), label: t('Days in a row') },
  ];
  const top = year.top[0];
  return (
    <Svg
      ref={ref}
      width={width}
      height={(width * CARD_HEIGHT) / CARD_WIDTH}
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
    >
      <G fontFamily="sans-serif">
        <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill={palette.background} />
        <SvgText x={left} y={150} fontSize={40} fontWeight="600" fill={palette.accentText}>
          Lelap
        </SvgText>
        <SvgText x={left} y={250} fontSize={76} fontWeight="700" fill={palette.text}>
          {t('{year} in sound', { year: String(year.year) })}
        </SvgText>
        <SvgText x={left} y={470} fontSize={190} fontWeight="700" fill={palette.accentText}>
          {roundTime(year.ms)}
        </SvgText>
        <SvgText x={left} y={540} fontSize={44} fill={palette.secondary}>
          {t('Time listened')}
        </SvgText>
        {counts.map((c, i) => (
          <SvgText
            key={c.label}
            x={left + i * 320}
            y={690}
            fontSize={96}
            fontWeight="700"
            fill={palette.text}
          >
            {c.value}
          </SvgText>
        ))}
        {counts.map((c, i) => (
          <SvgText
            key={`${c.label}-label`}
            x={left + i * 320}
            y={745}
            fontSize={30}
            fill={palette.secondary}
          >
            {clip(c.label, 20)}
          </SvgText>
        ))}
        <Rect
          x={left - 30}
          y={chartTop - 20}
          width={CARD_WIDTH - 2 * left + 60}
          height={chartHeight + 110}
          rx={28}
          fill={palette.surface}
        />
        {year.months.map((ms, i) => {
          const h = ms > 0 ? Math.max(8, (ms / peak) * chartHeight) : 4;
          return (
            <Rect
              key={`bar-${i}`}
              x={left + i * slot + 9}
              y={chartTop + chartHeight - h + 10}
              width={slot - 18}
              height={h}
              rx={10}
              fill={i === year.busiestMonth ? palette.accent : palette.bar}
            />
          );
        })}
        {year.months.map((_, i) => (
          <SvgText
            key={`month-${i}`}
            x={left + i * slot + slot / 2}
            y={chartTop + chartHeight + 60}
            fontSize={28}
            textAnchor="middle"
            fill={palette.secondary}
          >
            {clip(formatMonth(i), 4)}
          </SvgText>
        ))}
        {top ? (
          <SvgText x={left} y={1260} fontSize={38} fill={palette.text}>
            {clip(t('Most listened: {title}', { title: top.title || t('Untitled') }), 44)}
          </SvgText>
        ) : null}
      </G>
    </Svg>
  );
}

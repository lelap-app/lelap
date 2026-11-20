import { cueAt, episodeDetail, getBook, toBookPosition, type TranscriptCue } from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hint } from '../src/a11y';
import { t } from '../src/i18n';
import { IconButton } from '../src/components/Icon';
import { useReducedMotion } from '../src/components/Motion';
import { db } from '../src/db';
import { formatClock } from '../src/format';
import { seekToBookPosition, usePlayerState } from '../src/player';
import { loadTranscript, transcriptOf } from '../src/podcasting';
import { profileId } from '../src/profile';
import { READABLE } from '../src/layout';
import { useColors } from '../src/theme';

// After the listener scrolls, the list stops following the position for this long.
const FOLLOW_PAUSE_MS = 8_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The playing episode's or book part's transcript: the current line lit, a tap on a line seeks to it. */
export default function TranscriptScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = usePlayerState();
  const bookId = state.bookId;
  const list = useRef<FlatList<TranscriptCue>>(null);
  const [heldUntil, setHeldUntil] = useState(0);
  const reduced = useReducedMotion();

  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId]);
  const episode = useMemo(() => (bookId ? episodeDetail(db, bookId) : null), [bookId]);
  // A book's parts each have their own (M136): the next lecture brings its own text.
  const fileLocation = state.fileLocation;
  const source = useMemo(
    () => (bookId ? transcriptOf(bookId, fileLocation) : null),
    [bookId, fileLocation],
  );
  // Fetched when opened and kept for the session; the web app's proxy caches it for a day.
  const transcript = useQuery({
    queryKey: ['transcript', source?.url],
    queryFn: () => (source ? loadTranscript(source) : Promise.resolve([])),
    enabled: !!source,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
  const cues = transcript.data ?? [];
  const timed = cues.some((c) => c.startMs !== null);

  // An episode's times count from its start; a part's from the part's own start.
  const offset = detail && !episode ? toBookPosition(detail.files, fileLocation ?? '', 0) : 0;
  const position = detail
    ? toBookPosition(detail.files, fileLocation ?? '', state.positionMs) - offset
    : 0;
  const current = timed ? cueAt(cues, position) : -1;

  useEffect(() => {
    if (current < 0 || Date.now() < heldUntil) return;
    list.current?.scrollToIndex({ index: current, viewPosition: 0.3, animated: !reduced });
  }, [current, heldUntil, reduced]);

  const part = detail?.files.find((f) => f.location === fileLocation);
  const title = episode?.title ?? part?.title ?? detail?.book.title ?? t('Transcript');
  const subtitle = episode?.podcastTitle ?? (part?.title ? detail?.book.title : undefined);

  return (
    <View style={{ paddingTop: insets.top + 4 }} className="flex-1 bg-night">
      <View className="flex-row items-center gap-2 px-2 pb-2">
        <IconButton
          name="down"
          label={t('Close transcript')}
          size={26}
          color={colors.soft}
          onPress={() => router.back()}
        />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-paper">
            {title}
          </Text>
          {subtitle && (
            <Text numberOfLines={1} className="text-sm text-muted">
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      {!source ? (
        <Text className="px-6 pt-24 text-center text-muted">
          {episode ? t('This episode has no transcript.') : t('This part has no transcript.')}
        </Text>
      ) : transcript.isPending ? (
        <ActivityIndicator color={colors.amber} className="pt-24" />
      ) : transcript.isError ? (
        <Text className="px-6 pt-24 text-center text-muted">
          {t('The transcript could not be read: {error}', { error: message(transcript.error) })}
        </Text>
      ) : cues.length === 0 ? (
        <Text className="px-6 pt-24 text-center text-muted">{t('The transcript is empty.')}</Text>
      ) : (
        <FlatList
          ref={list}
          data={cues}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{
            ...READABLE,
            paddingHorizontal: 24,
            paddingBottom: insets.bottom + 120,
          }}
          onScrollBeginDrag={() => setHeldUntil(Date.now() + FOLLOW_PAUSE_MS)}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          }}
          renderItem={({ item, index }) => {
            const speakerChanged =
              item.speaker !== null && item.speaker !== cues[index - 1]?.speaker;
            const lit = index === current;
            const line = (
              <View className="gap-1 py-2">
                {speakerChanged && (
                  <Text
                    accessibilityRole="header"
                    className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted"
                  >
                    {item.speaker}
                  </Text>
                )}
                <Text
                  className={`text-lg leading-7 ${lit ? 'text-amber' : index < current ? 'text-soft' : 'text-paper'}`}
                >
                  {item.text}
                </Text>
              </View>
            );
            if (item.startMs === null || !bookId) return line;
            const start = item.startMs;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  speakerChanged ? `${item.speaker ?? ''}: ${item.text}` : item.text
                }
                {...hint(t('Plays from {time}', { time: formatClock(start) }))}
                onPress={() => {
                  setHeldUntil(0);
                  void seekToBookPosition(bookId, offset + start);
                }}
                className="active:opacity-60"
              >
                {line}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

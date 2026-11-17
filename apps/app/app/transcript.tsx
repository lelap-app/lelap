import { cueAt, episodeDetail, getBook, toBookPosition, type TranscriptCue } from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, IconButton } from '../src/components/Icon';
import { db } from '../src/db';
import { formatClock } from '../src/format';
import { seekToBookPosition, usePlayerState } from '../src/player';
import { loadTranscript, transcriptOf } from '../src/podcasting';
import { profileId } from '../src/profile';

// After the listener scrolls, the list stops following the position for this long.
const FOLLOW_PAUSE_MS = 8_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The playing episode's transcript: the current line lit, a tap on a line seeks to it. */
export default function TranscriptScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = usePlayerState();
  const bookId = state.bookId;
  const list = useRef<FlatList<TranscriptCue>>(null);
  const [heldUntil, setHeldUntil] = useState(0);

  const detail = useMemo(() => (bookId ? getBook(db, profileId, bookId) : null), [bookId]);
  const episode = useMemo(() => (bookId ? episodeDetail(db, bookId) : null), [bookId]);
  const source = useMemo(() => (bookId ? transcriptOf(bookId) : null), [bookId]);
  // Fetched when opened and kept for the session; the web app's proxy caches it for a day.
  const transcript = useQuery({
    queryKey: ['transcript', source?.url],
    queryFn: () => loadTranscript(bookId ?? ''),
    enabled: !!bookId && !!source,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60_000,
  });
  const cues = transcript.data ?? [];
  const timed = cues.some((c) => c.startMs !== null);

  const position = detail
    ? toBookPosition(detail.files, state.fileLocation ?? '', state.positionMs)
    : 0;
  const current = timed ? cueAt(cues, position) : -1;

  useEffect(() => {
    if (current < 0 || Date.now() < heldUntil) return;
    list.current?.scrollToIndex({ index: current, viewPosition: 0.3, animated: true });
  }, [current, heldUntil]);

  const title = episode?.title ?? detail?.book.title ?? 'Transcript';

  return (
    <View style={{ paddingTop: insets.top + 4 }} className="flex-1 bg-night">
      <View className="flex-row items-center gap-2 px-2 pb-2">
        <IconButton
          name="down"
          label="Close transcript"
          size={26}
          color={COLORS.soft}
          onPress={() => router.back()}
        />
        <View className="flex-1">
          <Text numberOfLines={1} className="text-base font-semibold text-paper">
            {title}
          </Text>
          {episode && (
            <Text numberOfLines={1} className="text-sm text-muted">
              {episode.podcastTitle}
            </Text>
          )}
        </View>
      </View>

      {!source ? (
        <Text className="px-6 pt-24 text-center text-muted">This episode has no transcript.</Text>
      ) : transcript.isPending ? (
        <ActivityIndicator color={COLORS.amber} className="pt-24" />
      ) : transcript.isError ? (
        <Text className="px-6 pt-24 text-center text-muted">
          The transcript could not be read: {message(transcript.error)}
        </Text>
      ) : cues.length === 0 ? (
        <Text className="px-6 pt-24 text-center text-muted">The transcript is empty.</Text>
      ) : (
        <FlatList
          ref={list}
          data={cues}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 120 }}
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
                  <Text className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">
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
                accessibilityHint={`Plays from ${formatClock(start)}`}
                onPress={() => {
                  setHeldUntil(0);
                  void seekToBookPosition(bookId, start);
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

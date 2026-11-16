import { findBookBySource, findStreamedBook, type FoundStream, getBook } from '@lelap/core';
import { CONTENT_TYPES, type ContentType, hasParts } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { playItem, queries, useAddons } from '../src/addons';
import { BookCover } from '../src/components/BookCover';
import { db } from '../src/db';
import { formatClock, formatDuration } from '../src/format';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

const PARTS_SHOWN = 8;

const isType = (value: string | undefined): value is ContentType =>
  (CONTENT_TYPES as readonly (string | undefined)[]).includes(value);

const streamLabel = (found: FoundStream) =>
  [found.stream.name, found.stream.title].filter(Boolean).join(' · ');

export default function ItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const type: ContentType = isType(params.type) ? params.type : 'audiobook';
  const id = params.id ?? '';
  const addons = useAddons();
  const [chosen, setChosen] = useState(0);
  const [allParts, setAllParts] = useState(false);
  const [starting, setStarting] = useState(false);

  const meta = useQuery(queries.meta(addons, type, id));
  const streams = useQuery(queries.streams(addons, type, id));

  const item = meta.data?.meta;
  const found = streams.data ?? [];
  const stream = found[Math.min(chosen, found.length - 1)];

  // The book in the library for the chosen recording, else for this item.
  // `version` is the signal to re-read the database.
  const sourceKey = stream?.stream.sourceKey;
  const saved = useMemo(() => {
    const bookId =
      (sourceKey ? findBookBySource(db, sourceKey) : null) ?? findStreamedBook(db, type, id);
    return bookId ? getBook(db, profileId, bookId) : null;
  }, [type, id, sourceKey, version]);
  const parts = stream && hasParts(stream.stream) ? stream.stream.parts : [];
  const progress =
    saved && saved.book.durationMs > 0 ? saved.book.bookPositionMs / saved.book.durationMs : 0;

  const play = async () => {
    setStarting(true);
    try {
      if (item && stream) await playItem(item, stream);
      else if (saved) await playBook(saved.book.id);
      else return;
      refresh();
      router.push('/player');
    } catch (error) {
      Alert.alert('Cannot play', error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const title = item?.name ?? saved?.book.title ?? '';
  const canPlay = (item !== undefined && stream !== undefined) || saved !== null;
  const playLabel =
    saved && saved.book.finishedAt === null && progress > 0
      ? `Continue · ${Math.min(99, Math.floor(progress * 100))} %`
      : 'Play';

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} className="self-start px-4 py-2">
        <Text className="text-2xl text-muted">‹</Text>
      </Pressable>

      {meta.isPending && !saved ? (
        <ActivityIndicator color="#f5b041" className="pt-24" />
      ) : !item && !saved ? (
        <Text className="px-4 pt-24 text-center text-muted">
          {meta.isError
            ? 'The add-on did not answer. Try again later.'
            : 'This item was not found.'}
        </Text>
      ) : (
        <View className="gap-5 px-4">
          <View className="items-center gap-3">
            <BookCover uri={item?.cover ?? saved?.book.coverUrl} title={title} size={220} />
            <Text className="text-center text-2xl font-semibold text-paper">{title}</Text>
            {(item?.author ?? saved?.book.author) && (
              <Text className="text-center text-base text-soft">
                {item?.author ?? saved?.book.author}
              </Text>
            )}
            <Text className="text-center text-sm text-muted">
              {[
                item?.narrators?.length ? `Read by ${item.narrators.join(', ')}` : null,
                item?.durationMs ? formatDuration(item.durationMs) : null,
                item?.year ? String(item.year) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>

          <Pressable
            disabled={!canPlay || starting}
            onPress={() => void play()}
            className={`items-center rounded-full py-3 ${canPlay ? 'bg-amber active:opacity-80' : 'bg-raised'}`}
          >
            {starting ? (
              <ActivityIndicator color="#1a1305" />
            ) : (
              <Text className={`text-base font-semibold ${canPlay ? 'text-ink' : 'text-muted'}`}>
                {streams.isPending && !saved
                  ? 'Looking for audio…'
                  : canPlay
                    ? playLabel
                    : 'No audio for this book yet'}
              </Text>
            )}
          </Pressable>
          {saved && (
            <Text className="-mt-3 text-center text-xs text-muted">
              In your library · streams while online
            </Text>
          )}

          {found.length > 1 && (
            <View className="gap-2">
              <Text className="text-xs uppercase tracking-wider text-muted">Recording</Text>
              {found.map((f, index) => (
                <Pressable
                  key={`${f.addon.url} ${f.stream.sourceKey}`}
                  onPress={() => setChosen(index)}
                  className={`rounded-lg border px-3 py-2 ${index === chosen ? 'border-amber' : 'border-line'}`}
                >
                  <Text className={index === chosen ? 'text-paper' : 'text-soft'}>
                    {streamLabel(f)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {item?.description && (
            <Text className="text-base leading-6 text-soft">{item.description}</Text>
          )}

          {parts.length > 1 && (
            <View className="gap-1">
              <Text className="pb-1 text-xs uppercase tracking-wider text-muted">
                {parts.length} parts
              </Text>
              {(allParts ? parts : parts.slice(0, PARTS_SHOWN)).map((part, index) => (
                <View key={part.url} className="flex-row gap-3 border-b border-line py-2">
                  <Text className="w-6 text-right text-muted">{index + 1}</Text>
                  <Text numberOfLines={1} className="flex-1 text-paper">
                    {part.title ?? `Part ${index + 1}`}
                  </Text>
                  <Text className="text-muted">{formatClock(part.durationMs)}</Text>
                </View>
              ))}
              {!allParts && parts.length > PARTS_SHOWN && (
                <Pressable onPress={() => setAllParts(true)} className="py-2">
                  <Text className="text-amber">Show all {parts.length}</Text>
                </Pressable>
              )}
            </View>
          )}

          {meta.data?.addon && (
            <Text className="text-xs text-muted">From {meta.data.addon.manifest.name}</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

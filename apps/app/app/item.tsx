import {
  bookSourceChoice,
  downloadSnapshot,
  findBookBySource,
  findStreamedBook,
  type FoundStream,
  getBook,
  getSourceChoice,
  pickSource,
  type SourceChoice,
  setSourceChoice,
  sourceLabel,
} from '@lelap/core';
import { CONTENT_TYPES, type ContentType, hasParts, type Meta } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../src/dialog';
import { COLORS, Icon, IconButton } from '../src/components/Icon';
import { addItem, playItem, queries, useAddons, useArtwork } from '../src/addons';
import { sourceCache } from '../src/availability';
import { BookCover, coverUri } from '../src/components/BookCover';
import { DownloadButton } from '../src/components/DownloadButton';
import { db } from '../src/db';
import { startDownload } from '../src/downloads';
import { formatClock, formatDuration } from '../src/format';
import { playBook, useLibrary } from '../src/player';
import { profileId } from '../src/profile';

const PARTS_SHOWN = 8;

const isType = (value: string | undefined): value is ContentType =>
  (CONTENT_TYPES as readonly (string | undefined)[]).includes(value);

const seriesLabel = (series: Meta['series']) => {
  const main = series?.[0];
  return main ? (main.position ? `${main.name}, book ${main.position}` : main.name) : null;
};

const streamLength = (found: FoundStream) =>
  hasParts(found.stream)
    ? found.stream.parts.reduce((sum, p) => sum + p.durationMs, 0)
    : (found.stream.durationMs ?? 0);

/** The second line of a source: which add-on, how long, how many parts. */
const sourceDetails = (found: FoundStream) => {
  const ms = streamLength(found);
  const count = hasParts(found.stream) ? found.stream.parts.length : 1;
  return [
    found.addon.manifest.name,
    ms > 0 ? formatDuration(ms) : null,
    count > 1 ? `${count} parts` : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

const addonCount = (n: number) => (n === 1 ? '1 add-on' : `${n} add-ons`);

/** A language's English name; some engines lack `Intl.DisplayNames`, so fall back to the code. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function ItemScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const params = useLocalSearchParams<{ type?: string; id?: string }>();
  const type: ContentType = isType(params.type) ? params.type : 'audiobook';
  const id = params.id ?? '';
  const addons = useAddons();
  const [picked, setPicked] = useState<SourceChoice | null>(null);
  const [allParts, setAllParts] = useState(false);
  const [starting, setStarting] = useState(false);

  const meta = useQuery(queries.meta(addons, type, id));
  // Wait for the meta: its external IDs reach add-ons that know the work by another ID.
  const sources = useQuery({
    ...queries.sources(addons, type, id, meta.data?.meta.externalIds),
    enabled: !meta.isPending,
  });

  const found = sources.data?.found ?? [];
  // What this page learned saves the cover badge a request of its own.
  useEffect(() => {
    const data = sources.data;
    if (!data) return;
    const first = data.found[0];
    if (first) sourceCache.set({ type, id }, { kind: 'stream', addon: first.addon.manifest.name });
    else if (data.failed.length === 0) sourceCache.set({ type, id }, { kind: 'none' });
  }, [sources.data, type, id]);
  // `version` is the signal to re-read the database.
  const remembered = useMemo(() => {
    const own = findStreamedBook(db, type, id);
    return [getSourceChoice(db, profileId, type, id), own ? bookSourceChoice(db, own) : null];
  }, [type, id, version]);
  const chosen = pickSource(found, [picked, ...remembered]);
  const stream = found[chosen];

  const choose = (f: FoundStream) => {
    const choice = { addonUrl: f.addon.url, sourceKey: f.stream.sourceKey };
    setPicked(choice);
    setSourceChoice(db, profileId, type, id, choice, Date.now());
  };

  // The book in the library for the chosen recording, else for this item.
  // `version` is the signal to re-read the database.
  const sourceKey = stream?.stream.sourceKey;
  const saved = useMemo(() => {
    const bookId =
      (sourceKey ? findBookBySource(db, sourceKey) : null) ?? findStreamedBook(db, type, id);
    return bookId ? getBook(db, profileId, bookId) : null;
  }, [type, id, sourceKey, version]);
  // Offline, a downloaded book shows the metadata saved with its download.
  const snapshot = useMemo(() => (saved ? downloadSnapshot(db, saved.book.id) : null), [saved]);
  const item = meta.data?.meta ?? snapshot ?? undefined;
  const artwork = useArtwork({
    id,
    type,
    cover: item?.cover ?? saved?.book.coverUrl ?? undefined,
  });
  const parts = stream && hasParts(stream.stream) ? stream.stream.parts : [];
  const sizeBytes = stream
    ? hasParts(stream.stream)
      ? stream.stream.parts.reduce((sum, p) => sum + (p.size ?? 0), 0)
      : (stream.stream.size ?? 0)
    : 0;
  const canDownload = stream
    ? stream.stream.downloadable !== false
    : saved?.book.source === 'addon';

  const download = async () => {
    const bookId = item && stream ? addItem(item, stream) : saved?.book.id;
    if (!bookId) return;
    await startDownload(bookId, meta.data?.meta ?? null);
  };
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
      showAlert('Cannot play', error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  const title = item?.name ?? saved?.book.title ?? '';
  const canPlay = (item !== undefined && stream !== undefined) || saved !== null;
  const looking = (meta.isPending || sources.isPending) && !saved;
  const noAudio = !saved && sources.isSuccess && found.length === 0;
  const language = item?.language ? languageName(item.language) : null;
  const playLabel =
    saved && saved.book.finishedAt === null && progress > 0
      ? `Continue · ${Math.min(99, Math.floor(progress * 100))} %`
      : 'Play';

  return (
    <ScrollView
      className="flex-1 bg-night"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
    >
      <View className="-ml-2 self-start px-2">
        <IconButton name="back" label="Back" color={COLORS.soft} onPress={() => router.back()} />
      </View>

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
            <BookCover
              uri={saved?.book.coverPath ? coverUri(saved.book) : artwork}
              title={title}
              size={220}
            />
            <Text className="text-center text-2xl font-semibold text-paper">{title}</Text>
            {(item?.author ?? saved?.book.author) && (
              <Text className="text-center text-base text-soft">
                {item?.author ?? saved?.book.author}
              </Text>
            )}
            <Text className="text-center text-sm text-muted">
              {[
                seriesLabel(item?.series),
                item?.narrators?.length ? `Read by ${item.narrators.join(', ')}` : null,
                item?.durationMs ? formatDuration(item.durationMs) : null,
                item?.year ? String(item.year) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>

          {noAudio ? (
            <NoAudio
              asked={sources.data?.asked.length ?? 0}
              failed={sources.data?.failed ?? []}
              onAddons={() => router.push('/addons')}
            />
          ) : sources.isError && !saved ? (
            <View className="items-center gap-2 rounded-2xl bg-raised p-4">
              <Text className="text-center text-soft">
                Your add-ons did not answer. Check the connection and try again.
              </Text>
              <Pressable onPress={() => void sources.refetch()} className="py-1">
                <Text className="font-semibold text-amber">Try again</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              disabled={!canPlay || starting}
              onPress={() => void play()}
              className={`items-center rounded-full py-3 ${canPlay ? 'bg-amber active:opacity-80' : 'bg-raised'}`}
            >
              {starting ? (
                <ActivityIndicator color="#1a1305" />
              ) : (
                <Text className={`text-base font-semibold ${canPlay ? 'text-ink' : 'text-muted'}`}>
                  {looking ? 'Looking for audio…' : playLabel}
                </Text>
              )}
            </Pressable>
          )}
          {saved && (
            <Text className="-mt-3 text-center text-xs text-muted">
              {saved.book.downloaded
                ? 'In your library · plays offline'
                : 'In your library · streams while online'}
            </Text>
          )}

          {canDownload && (
            <DownloadButton
              bookId={saved?.book.id ?? null}
              sizeBytes={sizeBytes}
              start={download}
            />
          )}

          {found.length > 0 && (
            <View className="gap-2">
              <Text className="text-xs uppercase tracking-wider text-muted">
                {found.length === 1 ? 'Source' : `${found.length} sources`}
              </Text>
              {found.map((f, index) => {
                const selected = index === chosen;
                return (
                  <Pressable
                    key={`${f.addon.url} ${f.stream.sourceKey}`}
                    onPress={() => choose(f)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${selected ? 'border-amber bg-raised' : 'border-line'}`}
                  >
                    {selected ? (
                      <Icon name="check" size={24} color={COLORS.amber} />
                    ) : (
                      <View className="m-[3px] h-[18px] w-[18px] rounded-full border-2 border-line" />
                    )}
                    <View className="flex-1">
                      <Text numberOfLines={2} className={selected ? 'text-paper' : 'text-soft'}>
                        {sourceLabel(f)}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-muted">
                        {sourceDetails(f)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              {(sources.data?.failed.length ?? 0) > 0 && (
                <Text className="text-xs text-muted">
                  {sources.data?.failed.join(', ')} did not answer.
                </Text>
              )}
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

          {(language || item?.genres?.length) && (
            <View className="flex-row flex-wrap gap-2">
              {[language, ...(item?.genres ?? []).slice(0, 6)].filter(Boolean).map((tag) => (
                <Text
                  key={tag}
                  className="rounded-full border border-line px-3 py-1 text-xs text-soft"
                >
                  {tag}
                </Text>
              ))}
            </View>
          )}

          {(meta.data?.addon || item?.link) && (
            <View className="flex-row items-center justify-between gap-3">
              {meta.data?.addon && (
                <Text className="flex-1 text-xs text-muted">
                  From {meta.data.addon.manifest.name}
                </Text>
              )}
              {item?.link && (
                <Pressable
                  onPress={() => void Linking.openURL(item.link ?? '')}
                  accessibilityRole="link"
                  className="flex-row items-center gap-1 py-1"
                >
                  <Text className="text-sm text-amber">More about this book</Text>
                  <Icon name="forward" size={16} color={COLORS.amber} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

/** The page for a work no installed add-on has audio for. */
function NoAudio({
  asked,
  failed,
  onAddons,
}: {
  asked: number;
  failed: string[];
  onAddons: () => void;
}) {
  const answered = asked - failed.length;
  return (
    <View className="items-center gap-2 rounded-2xl bg-raised px-4 py-5">
      <Icon name="cloud" size={28} color={COLORS.muted} />
      <Text className="text-center text-base font-semibold text-paper">
        No audio for this book yet
      </Text>
      <Text className="text-center text-sm leading-5 text-soft">
        {asked === 0
          ? 'None of your add-ons has audio for books like this one.'
          : `Asked ${addonCount(asked)}${failed.length > 0 ? `, ${answered} answered` : ''}; none has a recording.`}{' '}
        An add-on that knows this work, such as one for your own server, can add it.
      </Text>
      <Pressable onPress={onAddons} className="flex-row items-center gap-1 pt-1">
        <Text className="font-semibold text-amber">Manage add-ons</Text>
        <Icon name="forward" size={16} color={COLORS.amber} />
      </Pressable>
    </View>
  );
}

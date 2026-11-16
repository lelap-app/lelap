import {
  addToUpNext,
  type EpisodeItem,
  episodeBook,
  getSubscription,
  listEpisodes,
  schema,
  setAutoDownload,
  setFinished,
  unsubscribe,
} from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { eq } from 'drizzle-orm';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { queries, useAddons } from '../src/addons';
import { BookCover } from '../src/components/BookCover';
import { db, newId } from '../src/db';
import { startDownload } from '../src/downloads';
import { formatDuration, formatLeft } from '../src/format';
import { useLibrary } from '../src/player';
import { fetchFeed, playEpisode, runAutoDownload, subscribeToFeed } from '../src/podcasts';
import { profileId } from '../src/profile';

const KEEP = [1, 3, 5, 10];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function episodeStatus(e: EpisodeItem): string {
  const parts = [
    e.publishedAt ? new Date(e.publishedAt).toLocaleDateString() : null,
    e.finished
      ? 'Played'
      : e.positionMs > 0 && e.durationMs > 0
        ? formatLeft(e.durationMs - e.positionMs)
        : e.durationMs > 0
          ? formatDuration(e.durationMs)
          : null,
    e.downloadState === 'done' ? 'Downloaded' : e.downloadState === 'queued' ? 'Downloading' : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** A podcast: by `id` once stored, or by add-on `item` from Search and Discover. */
export default function PodcastScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const params = useLocalSearchParams<{ id?: string; item?: string }>();
  const addons = useAddons();
  const [busy, setBusy] = useState(false);

  // From an add-on item: its meta names the feed, which the phone then reads itself.
  const meta = useQuery({
    ...queries.meta(addons, 'podcast', params.item ?? ''),
    enabled: !params.id && !!params.item,
  });
  const feedUrl = meta.data?.meta.feed;
  const fetched = useQuery({
    queryKey: ['feed', feedUrl],
    queryFn: () => fetchFeed(feedUrl ?? ''),
    enabled: !params.id && !!feedUrl,
  });
  const podcastId = params.id ?? fetched.data;

  // `version` is the signal to re-read the database.
  const podcast = useMemo(
    () =>
      podcastId
        ? db.select().from(schema.podcasts).where(eq(schema.podcasts.id, podcastId)).get()
        : undefined,
    [podcastId, version],
  );
  const sub = useMemo(
    () => (podcastId ? getSubscription(db, profileId, podcastId) : null),
    [podcastId, version],
  );
  const list = useMemo(
    () => (podcastId ? listEpisodes(db, profileId, podcastId) : []),
    [podcastId, version],
  );

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      Alert.alert('Podcast', message(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const setRule = (autoDownload: boolean, keepLatest: number) => {
    if (!podcastId) return;
    setAutoDownload(db, profileId, podcastId, { autoDownload, keepLatest }, Date.now());
    void run(runAutoDownload);
  };

  const showActions = (e: EpisodeItem) => {
    const bookId = () => episodeBook(db, e.id, Date.now(), newId);
    Alert.alert(
      e.title,
      undefined,
      [
        {
          text: 'Play next',
          onPress: () => addToUpNext(db, profileId, bookId(), 'next', Date.now()),
        },
        {
          text: 'Add to Up Next',
          onPress: () => addToUpNext(db, profileId, bookId(), 'last', Date.now()),
        },
        {
          text: e.finished ? 'Mark as unplayed' : 'Mark as played',
          onPress: () => {
            setFinished(db, profileId, bookId(), !e.finished, Date.now());
            refresh();
          },
        },
      ],
      { cancelable: true },
    );
  };

  const loading = !podcast && (meta.isPending || fetched.isPending) && !meta.isError;
  const failed = !podcast && !loading;

  return (
    <FlatList
      className="flex-1 bg-night"
      data={podcast ? list : []}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
      ListHeaderComponent={
        <View className="gap-4 px-4 pb-2">
          <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
            <Text className="text-2xl text-muted">‹</Text>
          </Pressable>
          {loading && <ActivityIndicator color="#f5b041" className="pt-24" />}
          {failed && (
            <Text className="pt-24 text-center text-muted">
              {fetched.isError
                ? `The feed could not be read: ${message(fetched.error)}`
                : meta.data && !feedUrl
                  ? 'This podcast has no feed address.'
                  : 'This podcast was not found.'}
            </Text>
          )}
          {podcast && (
            <>
              <View className="flex-row gap-4">
                <BookCover uri={podcast.coverUrl} title={podcast.title} size={112} />
                <View className="flex-1 justify-center gap-1">
                  <Text className="text-xl font-semibold text-paper">{podcast.title}</Text>
                  {podcast.author && <Text className="text-soft">{podcast.author}</Text>}
                </View>
              </View>
              {podcast.description && (
                <Text numberOfLines={4} className="text-sm leading-5 text-soft">
                  {podcast.description}
                </Text>
              )}
              {sub ? (
                <View className="gap-3 rounded-xl border border-line p-3">
                  <View className="flex-row items-center gap-3">
                    <View className="flex-1">
                      <Text className="text-paper">Auto-download</Text>
                      <Text className="text-sm text-muted">
                        Keep the newest unplayed episodes on the phone; played ones are removed.
                      </Text>
                    </View>
                    <Switch
                      value={sub.autoDownload}
                      onValueChange={(v) => setRule(v, sub.keepLatest)}
                    />
                  </View>
                  {sub.autoDownload && (
                    <View className="flex-row flex-wrap gap-2">
                      {KEEP.map((k) => (
                        <Pressable
                          key={k}
                          onPress={() => setRule(true, k)}
                          className={`rounded-full border px-3 py-1 ${sub.keepLatest === k ? 'border-amber bg-amber' : 'border-line'}`}
                        >
                          <Text className={sub.keepLatest === k ? 'text-ink' : 'text-soft'}>
                            {k} newest
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  <Pressable
                    onPress={() => {
                      unsubscribe(db, profileId, podcast.id);
                      refresh();
                    }}
                  >
                    <Text className="text-danger">Unsubscribe</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void run(async () => void (await subscribeToFeed(podcast.feedUrl)))
                  }
                  className="items-center rounded-full bg-amber py-3 active:opacity-80"
                >
                  {busy ? (
                    <ActivityIndicator color="#1a1305" />
                  ) : (
                    <Text className="text-base font-semibold text-ink">Subscribe</Text>
                  )}
                </Pressable>
              )}
              <Text className="pt-2 text-xs uppercase tracking-wider text-muted">
                {list.length} episodes
              </Text>
            </>
          )}
        </View>
      }
      renderItem={({ item: e }) => (
        <Pressable
          onPress={() =>
            void run(async () => {
              await playEpisode(e.id);
              router.push('/player');
            })
          }
          onLongPress={() => showActions(e)}
          className={`flex-row items-center gap-3 border-b border-line px-4 py-3 active:bg-raised ${e.finished ? 'opacity-50' : ''}`}
        >
          <View className="flex-1 gap-1">
            <Text numberOfLines={2} className="text-base text-paper">
              {e.title}
            </Text>
            <Text numberOfLines={1} className="text-sm text-muted">
              {episodeStatus(e)}
            </Text>
          </View>
          {e.downloadState === null && (
            <Pressable
              hitSlop={10}
              onPress={() =>
                void run(() => startDownload(episodeBook(db, e.id, Date.now(), newId), null))
              }
            >
              <Text className="text-xl text-amber">↓</Text>
            </Pressable>
          )}
        </Pressable>
      )}
    />
  );
}

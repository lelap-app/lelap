import {
  addToUpNext,
  castOf,
  type EpisodeItem,
  episodeBook,
  type FeedPerson,
  groupBySeason,
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
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../src/dialog';
import { type Action, ActionSheet } from '../src/components/ActionSheet';
import { COLORS, Icon, IconButton } from '../src/components/Icon';
import { queries, useAddons } from '../src/addons';
import { BookCover } from '../src/components/BookCover';
import { db, newId } from '../src/db';
import { startDownload } from '../src/downloads';
import { formatDuration, formatLeft } from '../src/format';
import { useLibrary } from '../src/player';
import { fetchFeed, playEpisode, runAutoDownload, subscribeToFeed } from '../src/podcasts';
import { profileId } from '../src/profile';

const KEEP = [1, 3, 5, 10];

type Row =
  | { kind: 'season'; key: string; title: string; count: number }
  | { kind: 'episode'; key: string; episode: EpisodeItem };

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

function openLink(url: string) {
  Linking.openURL(url).catch(() => showAlert('Podcast', 'This link could not be opened.'));
}

/** Hosts, guests and crew from `podcast:person`; a tap opens the person's page if there is one. */
function People({ persons }: { persons: FeedPerson[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {persons.map((p) => (
        <Pressable
          key={`${p.name}-${p.role}`}
          disabled={!p.href}
          accessibilityRole={p.href ? 'link' : 'text'}
          onPress={() => p.href && openLink(p.href)}
          className="flex-row items-center gap-2 rounded-full border border-line py-1 pl-1 pr-3 active:bg-raised"
        >
          <BookCover uri={p.img} title={p.name} size={28} />
          <View>
            <Text numberOfLines={1} className="text-sm text-paper">
              {p.name}
            </Text>
            <Text className="text-xs text-muted">{roleLabel(p.role)}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function episodeStatus(e: EpisodeItem): string {
  const guests = (e.extras?.persons ?? []).filter((p) => p.role === 'guest').map((p) => p.name);
  const parts = [
    guests.length > 0 ? `With ${guests.join(', ')}` : null,
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
  const rows = useMemo((): Row[] => {
    const groups = groupBySeason(list);
    if (groups.length === 1) return list.map((e) => ({ kind: 'episode', key: e.id, episode: e }));
    return groups.flatMap((g): Row[] => [
      {
        kind: 'season',
        key: `season-${g.season ?? 'none'}`,
        title:
          g.season === null
            ? 'Other episodes'
            : g.name
              ? `Season ${g.season} · ${g.name}`
              : `Season ${g.season}`,
        count: g.episodes.length,
      },
      ...g.episodes.map((e): Row => ({ kind: 'episode', key: e.id, episode: e })),
    ]);
  }, [list]);
  const people = useMemo(() => castOf(podcast?.extras?.persons ?? []), [podcast]);
  const funding = podcast?.extras?.funding ?? [];

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showAlert('Podcast', message(error));
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

  const [actionEpisode, setActionEpisode] = useState<EpisodeItem | null>(null);
  const showActions = (e: EpisodeItem) => setActionEpisode(e);
  const episodeActions = (e: EpisodeItem): Action[] => {
    const bookId = () => episodeBook(db, e.id, Date.now(), newId);
    return [
      {
        icon: 'queue',
        label: 'Play next',
        onPress: () => addToUpNext(db, profileId, bookId(), 'next', Date.now()),
      },
      {
        icon: 'chapters',
        label: 'Add to Up Next',
        onPress: () => addToUpNext(db, profileId, bookId(), 'last', Date.now()),
      },
      {
        icon: 'check',
        label: e.finished ? 'Mark as unplayed' : 'Mark as played',
        onPress: () => {
          setFinished(db, profileId, bookId(), !e.finished, Date.now());
          refresh();
        },
      },
    ];
  };

  const loading = !podcast && (meta.isPending || fetched.isPending) && !meta.isError;
  const failed = !podcast && !loading;

  return (
    <>
      <FlatList
        className="flex-1 bg-night"
        data={podcast ? rows : []}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
        ListHeaderComponent={
          <View className="gap-4 px-4 pb-2">
            <View className="-ml-2 self-start">
              <IconButton
                name="back"
                label="Back"
                color={COLORS.soft}
                onPress={() => router.back()}
              />
            </View>
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
                {people.length > 0 && <People persons={people} />}
                {funding.map((f) => (
                  <Pressable
                    key={f.url}
                    accessibilityRole="link"
                    onPress={() => openLink(f.url)}
                    className="flex-row items-center gap-3 rounded-xl border border-line px-3 py-2 active:bg-raised"
                  >
                    <Icon name="heart" size={20} color={COLORS.amber} />
                    <View className="flex-1">
                      <Text className="text-paper">Support this show</Text>
                      {f.label && (
                        <Text numberOfLines={1} className="text-sm text-muted">
                          {f.label}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
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
        renderItem={({ item: row }) => {
          if (row.kind === 'season')
            return (
              <View className="flex-row items-baseline gap-2 border-b border-line px-4 pb-2 pt-5">
                <Text numberOfLines={1} className="flex-1 text-base font-semibold text-paper">
                  {row.title}
                </Text>
                <Text className="text-sm text-muted">{row.count}</Text>
              </View>
            );
          const e = row.episode;
          return (
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
                  accessibilityRole="button"
                  accessibilityLabel="Download episode"
                  onPress={() =>
                    void run(() => startDownload(episodeBook(db, e.id, Date.now(), newId), null))
                  }
                >
                  <Icon name="download" color={COLORS.amber} />
                </Pressable>
              )}
            </Pressable>
          );
        }}
      />
      <ActionSheet
        title={actionEpisode?.title ?? null}
        actions={actionEpisode ? episodeActions(actionEpisode) : []}
        onClose={() => setActionEpisode(null)}
      />
    </>
  );
}

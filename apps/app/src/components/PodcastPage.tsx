import {
  addToUpNext,
  type AudioFile,
  audioFileLabel,
  audioFilesOf,
  castOf,
  type EpisodeItem,
  episodeBook,
  episodeOfBook,
  type FeedLocation,
  type FeedPerson,
  type FeedValue,
  groupBySeason,
  getSubscription,
  isNewEpisode,
  listEpisodes,
  mapLink,
  markPodcastSeen,
  type SeenClock,
  schema,
  setAudioChoice,
  setAutoDownload,
  setFinished,
  SMALLEST_KEY,
  setTrim,
  TRIM_STEPS_S,
  unsubscribe,
  valueInfoOf,
} from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { eq } from 'drizzle-orm';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { READABLE, useWide } from '../layout';
import { openPlayer } from '../navigation';
import { showAlert } from '../dialog';
import { type Action, ActionSheet } from './ActionSheet';
import { Icon, IconButton } from './Icon';
import { queries, useAddons } from '../addons';
import { BookCover } from './BookCover';
import { newEpisodesBadges, useBadgesOn, withBadges } from './CoverBadges';
import { db, newId } from '../db';
import { Draggable } from '../drag';
import { startDownload } from '../downloads';
import { formatClock, formatDate, formatDuration, formatLeft } from '../format';
import * as audio from '../platform/audio';
import { pickEpisodeFile } from '../episodeFiles';
import { reloadBook, updateEpisodeFiles, useLibrary } from '../player';
import {
  fetchFeed,
  playEpisode,
  playSoundbite,
  runAutoDownload,
  subscribeToFeed,
} from '../podcasts';
import { profileId } from '../profile';
import { Pill } from './Pill';
import { ROW_BUTTON, TextButton, Toggle } from './TextButton';
import { useColors } from '../theme';

const KEEP = [1, 3, 5, 10];

type Row =
  | { kind: 'season'; key: string; title: string; count: number }
  | { kind: 'episode'; key: string; episode: EpisodeItem };

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

function openLink(url: string) {
  Linking.openURL(url).catch(() => showAlert(t('Podcast'), t('This link could not be opened.')));
}

/**
 * A `podcast:location` in the phone's map app, or on OpenStreetMap in a browser or when the
 * phone has no map app. No map is drawn in Lelap, so no tiles come from our servers.
 */
function openPlace(location: FeedLocation) {
  if (Platform.OS === 'web') return openLink(mapLink(location, 'web'));
  Linking.openURL(mapLink(location, 'app')).catch(() => openLink(mapLink(location, 'web')));
}

/** The place of a show or an episode; a tap opens it in maps. */
function PlaceLink({ location, compact }: { location: FeedLocation; compact?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('Open {name} in maps', { name: location.name })}
      onPress={() => openPlace(location)}
      className={`${compact ? 'min-h-10' : 'min-h-12'} flex-row items-center gap-1 self-start active:opacity-70`}
    >
      <Icon name="place" size={16} color={colors.amber} />
      <Text numberOfLines={1} className="shrink text-sm text-amber">
        {t('Place: {name}', { name: location.name })}
      </Text>
    </Pressable>
  );
}

// Names of the value types in the namespace; anything else is shown as the feed writes it.
const VALUE_TYPES: Record<string, string> = {
  lightning: 'Lightning',
  hive: 'Hive',
  webmonetization: 'Web Monetization',
};

/**
 * `podcast:value`, as information only: that the show takes value-for-value payments, through
 * what and for whom. Lelap sends no payments; that needs a decision first (M111).
 */
function ValueCard({ values }: { values: FeedValue[] }) {
  const colors = useColors();
  const info = valueInfoOf(values);
  const through = [...new Set(info.map((v) => VALUE_TYPES[v.type] ?? v.type))].join(', ');
  // With blocks of several types the recipients may differ per type; only one block's are shown.
  const shares = info.length === 1 ? (info[0]?.shares ?? []) : [];
  return (
    <View className="flex-row gap-3 rounded-xl border border-line px-3 py-2">
      <Icon name="info" size={20} color={colors.muted} />
      <View className="flex-1 gap-1">
        <Text className="text-paper">{t('Value for value')}</Text>
        <Text className="text-sm text-muted">
          {t('This show takes small payments as you listen, through {through}.', { through })}{' '}
          {t('Lelap does not send them.')}
        </Text>
        {shares.length === 1 && shares[0]?.name && (
          <Text className="text-sm text-muted">
            {t('Payments go to {name}.', { name: shares[0].name })}
          </Text>
        )}
        {shares.length > 1 && (
          <Text className="text-sm text-muted">
            {t('Shared between {names}.', {
              names: shares
                .map((s) => `${s.name ?? t('Unnamed')} ${s.percent.toLocaleString()}%`)
                .join(', '),
            })}
          </Text>
        )}
      </View>
    </View>
  );
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
          className="min-h-12 flex-row items-center gap-2 rounded-full border border-line py-1 ps-1 pe-3 active:bg-raised"
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

/**
 * Which of an episode's files plays (M103), for a show that offers alternates: automatic, the
 * smallest, or one the show names, held for every episode.
 */
function AudioChoiceRow({
  files,
  choice,
  onPick,
}: {
  files: AudioFile[];
  choice: string | null;
  onPick: (choice: string | null) => void;
}) {
  const label = t('Episode file');
  const options = [
    { key: null, text: t('Automatic') },
    { key: SMALLEST_KEY, text: t('Smallest') },
    ...files.map((f) => ({
      key: f.key,
      text: audioFileLabel(f) || (f.key === 'enclosure' ? t('The feed’s own file') : f.key),
    })),
  ];
  return (
    <View className="gap-2">
      <View>
        <Text className="text-paper">{label}</Text>
        <Text className="text-sm text-muted">
          {t('Automatic plays the feed’s own file, and the smallest one on mobile data.')}
        </Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-2"
      >
        {options.map((o) => {
          const selected = choice === o.key;
          return (
            <Pill
              key={o.key ?? 'auto'}
              accessibilityRole="radio"
              accessibilityLabel={o.text}
              onPress={() => onPick(o.key)}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              className={`rounded-full border px-3 py-1 ${selected ? 'border-amber bg-amber' : 'border-line'}`}
            >
              <Text className={selected ? 'text-ink' : 'text-soft'}>{o.text}</Text>
            </Pill>
          );
        })}
      </View>
    </View>
  );
}

/** Seconds to skip at one end of every episode; set once for the show. */
function TrimRow({
  label,
  hint,
  valueMs,
  onPick,
}: {
  label: string;
  hint: string;
  valueMs: number;
  onPick: (ms: number) => void;
}) {
  return (
    <View className="gap-2">
      <View>
        <Text className="text-paper">{label}</Text>
        <Text className="text-sm text-muted">{hint}</Text>
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        className="flex-row flex-wrap gap-2"
      >
        {TRIM_STEPS_S.map((s) => {
          const selected = valueMs === s * 1000;
          return (
            <Pill
              key={s}
              accessibilityRole="radio"
              accessibilityLabel={s === 0 ? t('Off') : t('{n} seconds', { n: s })}
              onPress={() => onPick(s * 1000)}
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              className={`rounded-full border px-3 py-1 ${selected ? 'border-amber bg-amber' : 'border-line'}`}
            >
              <Text className={selected ? 'text-ink' : 'text-soft'}>
                {s === 0 ? t('Off') : t('{n} s', { n: s })}
              </Text>
            </Pill>
          );
        })}
      </View>
    </View>
  );
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function episodeStatus(e: EpisodeItem, isNew: boolean): string {
  const guests = (e.extras?.persons ?? []).filter((p) => p.role === 'guest').map((p) => p.name);
  const soundbites = e.extras?.soundbites?.length ?? 0;
  const parts = [
    isNew ? t('New') : null,
    guests.length > 0 ? t('With {names}', { names: guests.join(', ') }) : null,
    soundbites === 0
      ? null
      : soundbites === 1
        ? t('1 soundbite')
        : t('{n} soundbites', { n: soundbites }),
    e.publishedAt ? formatDate(e.publishedAt) : null,
    e.finished
      ? t('Played')
      : e.positionMs > 0 && e.durationMs > 0
        ? formatLeft(e.durationMs - e.positionMs)
        : e.durationMs > 0
          ? formatDuration(e.durationMs)
          : null,
    e.downloadState === 'done'
      ? t('Downloaded')
      : e.downloadState === 'queued'
        ? t('Downloading')
        : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** A podcast: by `id` once stored, or by add-on `item` from Search and Discover. */
/**
 * A show's page with its episodes: full screen, or the middle column on a very wide window
 * (`column`, M113), where Back closes the column. `id` is a feed in the database, `item` an
 * add-on's podcast whose feed the page reads first.
 */
export function PodcastPage({
  onBack,
  column = false,
  ...params
}: {
  id?: string | undefined;
  item?: string | undefined;
  onBack: () => void;
  column?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const { version, refresh } = useLibrary();
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
  // When the listener last looked, kept while the page is open so its new episodes stay marked;
  // the page notes this visit at once, so the Podcasts tab's badge is gone on the way back.
  const subscribed = sub !== null;
  const [seenBefore, setSeenBefore] = useState<{ id: string; at: SeenClock | null } | null>(null);
  const noted = useRef<string | null>(null);
  useEffect(() => {
    if (!podcastId || !subscribed || noted.current === podcastId) return;
    noted.current = podcastId;
    setSeenBefore({ id: podcastId, at: markPodcastSeen(db, profileId, podcastId, Date.now()) });
    refresh();
  }, [podcastId, subscribed, refresh]);
  const seenAt = seenBefore && seenBefore.id === podcastId ? seenBefore.at : null;
  const newCount = useMemo(
    () => list.filter((e) => isNewEpisode(e, seenAt)).length,
    [list, seenAt],
  );
  const headerBadges = newEpisodesBadges(newCount, useBadgesOn());
  const rows = useMemo((): Row[] => {
    const groups = groupBySeason(list);
    if (groups.length === 1) return list.map((e) => ({ kind: 'episode', key: e.id, episode: e }));
    return groups.flatMap((g): Row[] => [
      {
        kind: 'season',
        key: `season-${g.season ?? 'none'}`,
        title:
          g.season === null
            ? t('Other episodes')
            : g.name
              ? `${t('Season {n}', { n: g.season ?? '' })} · ${g.name}`
              : t('Season {n}', { n: g.season ?? '' }),
        count: g.episodes.length,
      },
      ...g.episodes.map((e): Row => ({ kind: 'episode', key: e.id, episode: e })),
    ]);
  }, [list]);
  const people = useMemo(() => castOf(podcast?.extras?.persons ?? []), [podcast]);
  const funding = podcast?.extras?.funding ?? [];
  // Some feeds name recipients per episode only; the newest such episode stands for the show.
  const value = useMemo(
    () =>
      podcast?.extras?.value?.length
        ? podcast.extras.value
        : (list.find((e) => e.extras?.value?.length)?.extras?.value ?? []),
    [podcast, list],
  );

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showAlert(t('Podcast'), message(error));
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

  const changeTrim = (trim: { skipIntroMs: number; skipOutroMs: number }) => {
    if (!podcastId) return;
    setTrim(db, profileId, podcastId, trim, Date.now());
    // Up Next is sent again on refresh. A loaded episode of this show takes the new values now
    // on Android; the web player, which would restart the file, takes them while paused.
    void audio.getState().then(({ bookId: loaded }) => {
      if (loaded && episodeOfBook(db, loaded)?.podcastId === podcastId) {
        void reloadBook(loaded, Platform.OS === 'android').catch(() => {});
      }
    });
    refresh();
  };

  // The show's files, from its newest episode that lists alternates.
  const audioFiles = useMemo(() => {
    const newest = list.find((e) => (e.extras?.alternates?.length ?? 0) > 0);
    return newest ? audioFilesOf(newest) : [];
  }, [list]);

  const changeAudioChoice = (choice: string | null) => {
    if (!podcastId) return;
    setAudioChoice(db, profileId, podcastId, choice, Date.now());
    // A loaded episode of this show switches file at its place; a downloaded one keeps its file.
    void audio.getState().then(({ bookId: loaded }) => {
      if (!loaded || episodeOfBook(db, loaded)?.podcastId !== podcastId) return;
      if (pickEpisodeFile(loaded))
        void reloadBook(loaded, Platform.OS === 'android').catch(() => {});
      else void updateEpisodeFiles(loaded).catch(() => {});
    });
    refresh();
  };

  const [actionEpisode, setActionEpisode] = useState<EpisodeItem | null>(null);
  const showActions = (e: EpisodeItem) => setActionEpisode(e);
  const episodeActions = (e: EpisodeItem): Action[] => {
    const bookId = () => episodeBook(db, e.id, Date.now(), newId);
    return [
      {
        icon: 'queue',
        label: t('Play next'),
        onPress: () => addToUpNext(db, profileId, bookId(), 'next', Date.now()),
      },
      {
        icon: 'chapters',
        label: t('Add to Up Next'),
        onPress: () => addToUpNext(db, profileId, bookId(), 'last', Date.now()),
      },
      {
        icon: 'check',
        label: e.finished ? t('Mark as unplayed') : t('Mark as played'),
        onPress: () => {
          setFinished(db, profileId, bookId(), !e.finished, Date.now());
          refresh();
        },
      },
      // `podcast:soundbite`: the stretches the show picked to start with (M75), played as clips.
      ...(e.extras?.soundbites ?? []).map((s): Action => ({
        icon: 'play',
        label: s.title
          ? t('Soundbite: {title} ({time})', { title: s.title, time: formatClock(s.startMs) })
          : t('Soundbite at {time}', { time: formatClock(s.startMs) }),
        onPress: () =>
          void run(async () => {
            await playSoundbite(e.id, s);
            openPlayer(router);
          }),
      })),
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
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          ...(wide && !column ? READABLE : {}),
        }}
        ListHeaderComponent={
          <View className="gap-4 px-4 pb-2">
            <View className="-ms-2 self-start">
              <IconButton
                name={column ? 'close' : 'back'}
                label={column ? t('Close') : t('Back')}
                color={colors.soft}
                onPress={onBack}
              />
            </View>
            {loading && <ActivityIndicator color={colors.amber} className="pt-24" />}
            {failed && (
              <Text accessibilityLiveRegion="polite" className="pt-24 text-center text-muted">
                {fetched.isError
                  ? t('The feed could not be read: {error}', { error: message(fetched.error) })
                  : meta.data && !feedUrl
                    ? t('This podcast has no feed address.')
                    : t('This podcast was not found.')}
              </Text>
            )}
            {podcast && (
              <>
                <View className="flex-row gap-4">
                  <BookCover
                    uri={podcast.coverUrl}
                    title={podcast.title}
                    size={112}
                    badges={headerBadges}
                  />
                  <View className="flex-1 justify-center gap-1">
                    <Text
                      accessibilityRole="header"
                      accessibilityLabel={withBadges([podcast.title], headerBadges)}
                      className="text-xl font-semibold text-paper"
                    >
                      {podcast.title}
                    </Text>
                    {podcast.author && <Text className="text-soft">{podcast.author}</Text>}
                    {podcast.extras?.location && <PlaceLink location={podcast.extras.location} />}
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
                    className="min-h-12 flex-row items-center gap-3 rounded-xl border border-line px-3 py-2 active:bg-raised"
                  >
                    <Icon name="heart" size={20} color={colors.amber} />
                    <View className="flex-1">
                      <Text className="text-paper">{t('Support this show')}</Text>
                      {f.label && (
                        <Text numberOfLines={1} className="text-sm text-muted">
                          {f.label}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
                {value.length > 0 && <ValueCard values={value} />}
                {sub ? (
                  <View className="gap-3 rounded-xl border border-line p-3">
                    <View className="flex-row items-center gap-3">
                      <View className="flex-1">
                        <Text className="text-paper">{t('Auto-download')}</Text>
                        <Text className="text-sm text-muted">
                          {t(
                            'Keep the newest unplayed episodes on the phone; played ones are removed.',
                          )}
                        </Text>
                      </View>
                      <Toggle
                        accessibilityLabel={t('Auto-download')}
                        value={sub.autoDownload}
                        onValueChange={(v) => setRule(v, sub.keepLatest)}
                      />
                    </View>
                    {sub.autoDownload && (
                      <View className="flex-row flex-wrap gap-2">
                        {KEEP.map((k) => (
                          <Pill
                            key={k}
                            onPress={() => setRule(true, k)}
                            accessibilityState={{ selected: sub.keepLatest === k }}
                            aria-selected={sub.keepLatest === k}
                            className={`rounded-full border px-3 py-1 ${sub.keepLatest === k ? 'border-amber bg-amber' : 'border-line'}`}
                          >
                            <Text className={sub.keepLatest === k ? 'text-ink' : 'text-soft'}>
                              {t('{n} newest', { n: k })}
                            </Text>
                          </Pill>
                        ))}
                      </View>
                    )}
                    <TrimRow
                      label={t('Skip intro')}
                      hint={t('Every episode starts this far in.')}
                      valueMs={sub.skipIntroMs}
                      onPick={(ms) => changeTrim({ skipIntroMs: ms, skipOutroMs: sub.skipOutroMs })}
                    />
                    <TrimRow
                      label={t('Skip outro')}
                      hint={t('Every episode ends this long before its end.')}
                      valueMs={sub.skipOutroMs}
                      onPick={(ms) => changeTrim({ skipIntroMs: sub.skipIntroMs, skipOutroMs: ms })}
                    />
                    {audioFiles.length > 1 && (
                      <AudioChoiceRow
                        files={audioFiles}
                        choice={sub.audioChoice}
                        onPick={changeAudioChoice}
                      />
                    )}
                    <TextButton
                      text={t('Unsubscribe')}
                      onPress={() => {
                        unsubscribe(db, profileId, podcast.id);
                        refresh();
                      }}
                      tone="danger"
                    />
                  </View>
                ) : (
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      void run(async () => void (await subscribeToFeed(podcast.feedUrl)))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t('Subscribe')}
                    accessibilityState={{ busy, disabled: busy }}
                    className="min-h-12 items-center justify-center rounded-full bg-amber py-3 active:opacity-80"
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.ink} />
                    ) : (
                      <Text className="text-base font-semibold text-ink">{t('Subscribe')}</Text>
                    )}
                  </Pressable>
                )}
                <Text
                  accessibilityRole="header"
                  className="pt-2 text-xs uppercase tracking-wider text-muted"
                >
                  {list.length === 1 ? t('1 episode') : t('{n} episodes', { n: list.length })}
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
            // The episode can be dragged onto a list, on the web and on a tablet (M113, M120).
            <Draggable item={{ kind: 'episode', id: e.id }} label={e.title}>
              <Pressable
                onPress={() =>
                  void run(async () => {
                    await playEpisode(e.id);
                    openPlayer(router);
                  })
                }
                onLongPress={() => showActions(e)}
                {...ROW_BUTTON}
                className="flex-row items-center gap-3 border-b border-line px-4 py-3 active:bg-raised"
              >
                <View className="flex-1 gap-1">
                  {/* Finished episodes are dimmed by colour, not opacity, so they stay readable. */}
                  <Text
                    numberOfLines={2}
                    className={`text-base ${e.finished ? 'text-muted' : 'text-paper'}`}
                  >
                    {e.title}
                  </Text>
                  <Text numberOfLines={1} className="text-sm text-muted">
                    {episodeStatus(e, isNewEpisode(e, seenAt))}
                  </Text>
                  {e.extras?.location &&
                    e.extras.location.name !== podcast?.extras?.location?.name && (
                      <PlaceLink location={e.extras.location} compact />
                    )}
                </View>
                {e.downloadState === null && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('Download episode')}
                    className="h-12 w-12 items-center justify-center"
                    onPress={() =>
                      void run(() => startDownload(episodeBook(db, e.id, Date.now(), newId), null))
                    }
                  >
                    <Icon name="download" color={colors.amber} />
                  </Pressable>
                )}
              </Pressable>
            </Draggable>
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

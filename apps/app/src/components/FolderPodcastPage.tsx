import {
  addToUpNext,
  episodesBefore,
  type FolderEpisode,
  getBook,
  listFolderEpisodes,
  setEpisodesPlayed,
  undoEpisodes,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  type AccessibilityActionEvent,
  Animated,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { t } from '../i18n';
import { db } from '../db';
import { showAlert } from '../dialog';
import { switchToBook } from '../folderView';
import { formatDuration, formatLeft } from '../format';
import { READABLE, useWide } from '../layout';
import { openPlayer } from '../navigation';
import { playFolderEpisode, reloadBook, updateEpisodeMarks, useLibrary } from '../player';
import { profileId } from '../profile';
import { useColors } from '../theme';
import { type Action, ActionSheet } from './ActionSheet';
import { BookCover, coverUri } from './BookCover';
import { Icon } from './Icon';
import { LoadState } from './LoadState';
import { Pill } from './Pill';
import { ScreenHeader } from './ScreenHeader';
import { SwipeBackdrop, useRowSwipe } from './RowSwipe';
import { ROW_BUTTON } from './TextButton';
import { UndoBar, type UndoNotice } from './UndoBar';

type Filter = 'all' | 'unplayed' | 'played';

type Group = { key: string; season: number | null; title: string; episodes: FolderEpisode[] };

type Row =
  | { kind: 'season'; key: string; group: Group; open: boolean }
  | { kind: 'episode'; key: string; episode: FolderEpisode }
  | { kind: 'empty'; key: string };

const pad = (n: number) => String(n).padStart(2, '0');

function codeOf(e: FolderEpisode): string | null {
  if (e.number === null) return null;
  return e.season === null ? `E${pad(e.number)}` : `S${pad(e.season)}E${pad(e.number)}`;
}

const playedCount = (list: FolderEpisode[]) => list.filter((e) => e.status === 'played').length;

function playedText(played: number, total: number): string {
  if (played === total) return t('All played');
  if (played === 0) return t('None played');
  return t('{played} of {total} played', { played, total });
}

function statusText(e: FolderEpisode): string {
  if (e.status === 'played') return t('Played');
  if (e.status === 'started' && e.durationMs > 0) return formatLeft(e.durationMs - e.positionMs);
  return e.durationMs > 0 ? formatDuration(e.durationMs) : '';
}

/** Seasons from the `S01E01` codes in the file names; one group when there are none or one. */
function groupBySeason(episodes: FolderEpisode[]): Group[] {
  const seasons = new Set(episodes.map((e) => e.season));
  if (seasons.size < 2) {
    return [{ key: 'all', season: null, title: '', episodes }];
  }
  const groups = new Map<string, Group>();
  for (const e of episodes) {
    const key = e.season === null ? 'other' : String(e.season);
    const group = groups.get(key) ?? {
      key,
      season: e.season,
      title: e.season === null ? t('Other episodes') : t('Season {n}', { n: e.season }),
      episodes: [],
    };
    group.episodes.push(e);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Played, started or not: a filled circle with a check, a ring with an arc as far as it was
 * heard, an empty ring. Told apart by shape, not colour alone.
 */
function Mark({ episode }: { episode: FolderEpisode }) {
  const colors = useColors();
  const r = 11;
  const length = 2 * Math.PI * r;
  if (episode.status === 'played') {
    return (
      <Svg width={26} height={26} viewBox="0 0 26 26">
        <Circle cx={13} cy={13} r={12} fill={colors.soft} />
        <Path
          d="M7.8 13.4l3.4 3.4 7-7.2"
          fill="none"
          stroke={colors.night}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  const share =
    episode.status === 'started' && episode.durationMs > 0
      ? Math.min(1, Math.max(0.04, episode.positionMs / episode.durationMs))
      : 0;
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      <Circle cx={13} cy={13} r={r} fill="none" stroke={colors.muted} strokeWidth={2} />
      {share > 0 && (
        <Circle
          cx={13}
          cy={13}
          r={r}
          fill="none"
          stroke={colors.amber}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${share * length} ${length}`}
          transform="rotate(-90 13 13)"
        />
      )}
    </Svg>
  );
}

/** One cell per episode, in play order, grouped by season. */
function Strip({ groups, height }: { groups: Group[]; height: number }) {
  return (
    <View className="flex-row" style={{ gap: 5, height }}>
      {groups.map((g) => (
        <View key={g.key} className="flex-row" style={{ flex: g.episodes.length, gap: 2 }}>
          {g.episodes.map((e) => (
            <View
              key={e.location}
              className={`flex-1 rounded-sm ${
                e.status === 'played'
                  ? 'bg-soft'
                  : e.status === 'started'
                    ? 'bg-amber'
                    : 'border border-muted'
              }`}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * One episode: a tap plays it, its circle marks it, and a swipe to the left marks it played or
 * not (M158), which TalkBack offers as an action.
 */
function EpisodeRow({
  episode: e,
  onPlay,
  onMenu,
  onMark,
  onSwipe,
}: {
  episode: FolderEpisode;
  onPlay: () => void;
  onMenu: () => void;
  onMark: () => void;
  onSwipe: () => void;
}) {
  const colors = useColors();
  const code = codeOf(e);
  const played = e.status === 'played';
  const swipeLabel = played ? t('Mark as unplayed') : t('Mark as played');
  const { x, width, handlers, justSwiped } = useRowSwipe(onSwipe);
  const onAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'swipe') onSwipe();
  };
  return (
    <View onLayout={(event) => (width.current = event.nativeEvent.layout.width)}>
      <SwipeBackdrop x={x} icon="check" label={swipeLabel} />
      <Animated.View style={{ transform: [{ translateX: x }] }} {...handlers}>
        <Pressable
          onPress={() => {
            if (!justSwiped()) onPlay();
          }}
          onLongPress={onMenu}
          {...ROW_BUTTON}
          accessibilityLabel={[code, e.title, statusText(e)].filter(Boolean).join(', ')}
          accessibilityActions={[{ name: 'swipe', label: swipeLabel }]}
          onAccessibilityAction={onAction}
          className="flex-row items-center gap-1 border-b border-line bg-night py-2 pe-2 ps-1 active:bg-raised"
        >
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={
              played
                ? t('Mark {title} as unplayed', { title: e.title })
                : t('Mark {title} as played', { title: e.title })
            }
            accessibilityState={{ checked: played }}
            aria-checked={played}
            onPress={onMark}
            className="h-12 w-12 items-center justify-center rounded-full active:bg-line"
          >
            <Mark episode={e} />
          </Pressable>
          <View className="flex-1 gap-0.5">
            {/* Played episodes are dimmed by colour, not opacity, so they stay readable. */}
            <Text numberOfLines={2} className={`text-body ${played ? 'text-muted' : 'text-paper'}`}>
              {e.title}
            </Text>
            <Text
              numberOfLines={1}
              className={`text-detail ${e.status === 'started' ? 'text-amber' : 'text-muted'}`}
            >
              {[code, statusText(e)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('More for {title}', { title: e.title })}
            onPress={onMenu}
            className="h-12 w-12 items-center justify-center rounded-full active:bg-line"
          >
            <Icon name="more" size={20} color={colors.muted} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/**
 * A book of episode files shown as a podcast (M157): what is played at a glance, filters, seasons
 * from the file names, and a mark per episode that a tap sets or clears.
 */
export function FolderPodcastPage({ id, onBack }: { id: string; onBack: () => void }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const wide = useWide();
  const { version, refresh } = useLibrary();
  const [filter, setFilter] = useState<Filter>('all');
  const [newestFirst, setNewestFirst] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<FolderEpisode | 'show' | null>(null);
  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);

  // `version` is the signal to read the database again.
  const detail = useMemo(() => getBook(db, profileId, id), [id, version]);
  const episodes = useMemo(() => listFolderEpisodes(db, profileId, id), [id, version]);
  const groups = useMemo(() => groupBySeason(episodes), [episodes]);
  const played = playedCount(episodes);
  const leftMs = episodes
    .filter((e) => e.status !== 'played')
    .reduce((sum, e) => sum + Math.max(0, e.durationMs - e.positionMs), 0);
  const next =
    episodes.find((e) => e.current && e.status !== 'played') ??
    episodes.find((e) => e.status !== 'played');
  const nextLocation = next?.location;

  const rows = useMemo((): Row[] => {
    const keep = (e: FolderEpisode) =>
      filter === 'all' || (filter === 'played') === (e.status === 'played');
    // The season being heard starts open; with one group there is nothing to fold.
    const isOpen = (g: Group) =>
      groups.length === 1 || (opened[g.key] ?? g.episodes.some((e) => e.location === nextLocation));
    const ordered = newestFirst ? [...groups].reverse() : groups;
    const out: Row[] = [];
    for (const g of ordered) {
      const shown = g.episodes.filter(keep);
      if (newestFirst) shown.reverse();
      if (shown.length === 0 && filter !== 'all') continue;
      const open = isOpen(g);
      if (groups.length > 1) out.push({ kind: 'season', key: `season-${g.key}`, group: g, open });
      if (open) {
        out.push(...shown.map((e): Row => ({ kind: 'episode', key: e.location, episode: e })));
      }
    }
    if (!out.some((r) => r.kind === 'episode') && groups.length === 1) {
      out.push({ kind: 'empty', key: 'empty' });
    }
    return out;
  }, [groups, filter, newestFirst, opened, nextLocation]);

  const play = (e: FolderEpisode) =>
    void playFolderEpisode(id, e.location)
      .then(() => openPlayer(router))
      .catch((error: unknown) =>
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error)),
      )
      .finally(refresh);
  // The player takes the new marks: a paused one the place they moved, a playing one which
  // episodes playing on skips.
  const marksChanged = () => {
    void reloadBook(id, false).catch(() => {});
    void updateEpisodeMarks(id).catch(() => {});
    refresh();
  };
  const mark = (locations: string[], value: boolean) => {
    setEpisodesPlayed(db, profileId, id, locations, value, Date.now());
    marksChanged();
  };
  // A swipe marks at once, with Undo, since a swipe is easily made by mistake.
  const swipeMark = (e: FolderEpisode) => {
    const before = episodesBefore(db, profileId, id, [e.location]);
    const played = e.status !== 'played';
    mark([e.location], played);
    setNotice({
      text: played
        ? t('{title} marked as played', { title: e.title })
        : t('{title} marked as unplayed', { title: e.title }),
      undo: () => {
        undoEpisodes(db, profileId, before, Date.now());
        marksChanged();
      },
    });
  };
  const queue = (e: FolderEpisode, where: 'next' | 'last') => {
    addToUpNext(db, profileId, id, where, Date.now(), e.location);
    refresh();
  };

  const episodeActions = (e: FolderEpisode): Action[] => {
    // By location: a refresh while the sheet is open makes new episode objects.
    const group = groups.find((g) => g.episodes.some((x) => x.location === e.location));
    const before = episodes.filter((x) => x.index < e.index && x.status !== 'played');
    const seasonLeft = group?.episodes.filter((x) => x.status !== 'played') ?? [];
    return [
      { icon: 'play', label: t('Play'), onPress: () => play(e) },
      { icon: 'queue', label: t('Play next'), onPress: () => queue(e, 'next') },
      { icon: 'chapters', label: t('Add to Up next'), onPress: () => queue(e, 'last') },
      {
        icon: 'check',
        label: e.status === 'played' ? t('Mark as unplayed') : t('Mark as played'),
        onPress: () => mark([e.location], e.status !== 'played'),
      },
      ...(groups.length > 1 && group?.season !== null && group && seasonLeft.length > 0
        ? [
            {
              icon: 'check' as const,
              label: t('Mark season {n} as played', { n: group.season ?? '' }),
              onPress: () =>
                mark(
                  seasonLeft.map((x) => x.location),
                  true,
                ),
            },
          ]
        : []),
      ...(before.length > 0
        ? [
            {
              icon: 'check' as const,
              label: t('Mark everything before as played'),
              onPress: () =>
                mark(
                  before.map((x) => x.location),
                  true,
                ),
            },
          ]
        : []),
    ];
  };
  const showActions: Action[] = [
    {
      icon: 'library',
      label: t('Show as book'),
      onPress: () =>
        switchToBook(id, () => {
          refresh();
          onBack();
        }),
    },
  ];

  const book = detail?.book;
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: t('All'), count: episodes.length },
    { key: 'unplayed', label: t('Unplayed'), count: episodes.length - played },
    { key: 'played', label: t('Played'), count: played },
  ];

  return (
    <>
      <FlatList
        className="flex-1 bg-night"
        data={book ? rows : []}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          ...(wide ? READABLE : {}),
        }}
        ListHeaderComponent={
          <View className="gap-4 px-4 pb-2">
            <ScreenHeader
              onBack={onBack}
              action={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('More')}
                  onPress={() => setMenu('show')}
                  className="h-12 w-12 items-center justify-center rounded-full active:bg-raised"
                >
                  <Icon name="more" color={colors.paper} />
                </Pressable>
              }
            />
            <LoadState
              loading={false}
              failed={book ? false : { title: t('This book is not in the library.') }}
              onRetry={refresh}
            >
              {book && (
                <>
                  <View className="flex-row gap-4">
                    <BookCover uri={coverUri(book)} title={book.title} size={112} />
                    <View className="flex-1 justify-center gap-1">
                      <Text
                        accessibilityRole="header"
                        className="text-heading font-semibold text-paper"
                      >
                        {book.title}
                      </Text>
                      {book.author && <Text className="text-soft">{book.author}</Text>}
                      <Text className="text-detail text-muted">
                        {episodes.length === 1
                          ? t('1 episode')
                          : t('{n} episodes', { n: episodes.length })}
                      </Text>
                    </View>
                  </View>
                  <View
                    className="gap-2"
                    accessible
                    accessibilityLabel={playedText(played, episodes.length)}
                  >
                    <View className="flex-row items-baseline justify-between gap-3">
                      <Text className="text-body font-semibold text-paper">
                        {playedText(played, episodes.length)}
                      </Text>
                      {leftMs > 0 && (
                        <Text className="text-detail text-soft">{formatLeft(leftMs)}</Text>
                      )}
                    </View>
                    <Strip groups={groups} height={14} />
                  </View>
                  {next && (
                    <View className="flex-row items-center gap-3 rounded-xl bg-raised py-3 ps-4 pe-3">
                      <View className="flex-1 gap-0.5">
                        <Text className="text-caption uppercase tracking-wider text-amber">
                          {next.status === 'started' ? t('Continue') : t('Next unplayed')}
                        </Text>
                        <Text numberOfLines={2} className="text-body font-semibold text-paper">
                          {[codeOf(next), next.title].filter(Boolean).join(' · ')}
                        </Text>
                        <Text className="text-detail text-soft">{statusText(next)}</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('Play {title}', { title: next.title })}
                        onPress={() => play(next)}
                        className="h-14 w-14 items-center justify-center rounded-full bg-amber active:opacity-80"
                      >
                        <Icon name="play" color={colors.ink} />
                      </Pressable>
                    </View>
                  )}
                  <View className="flex-row flex-wrap items-center gap-2">
                    <View
                      accessibilityRole="radiogroup"
                      className="flex-1 flex-row flex-wrap gap-2"
                    >
                      {filters.map((f) => {
                        const selected = filter === f.key;
                        return (
                          <Pill
                            key={f.key}
                            accessibilityRole="radio"
                            accessibilityLabel={`${f.label}, ${f.count}`}
                            accessibilityState={{ checked: selected }}
                            aria-checked={selected}
                            onPress={() => setFilter(f.key)}
                            className={`rounded-full border px-3 py-1 ${selected ? 'border-amber bg-amber' : 'border-line'}`}
                          >
                            <Text className={selected ? 'font-semibold text-ink' : 'text-soft'}>
                              {f.label} {f.count}
                            </Text>
                          </Pill>
                        );
                      })}
                    </View>
                    <Pill
                      accessibilityLabel={newestFirst ? t('Newest first') : t('Oldest first')}
                      onPress={() => setNewestFirst((v) => !v)}
                      className="rounded-full px-2 py-1"
                    >
                      <Text className="text-soft">
                        {newestFirst ? t('Newest first') : t('Oldest first')}
                      </Text>
                    </Pill>
                  </View>
                </>
              )}
            </LoadState>
          </View>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'empty') {
            return (
              <Text className="px-4 py-4 text-detail text-muted">
                {filter === 'played'
                  ? t('No episode is played yet.')
                  : t('Every episode is played.')}
              </Text>
            );
          }
          if (row.kind === 'season') {
            const g = row.group;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: row.open }}
                onPress={() => setOpened((o) => ({ ...o, [g.key]: !row.open }))}
                className="flex-row items-center gap-3 border-b border-line px-4 pb-3 pt-4 active:bg-raised"
              >
                <View className="flex-1 gap-2">
                  <View className="flex-row items-baseline gap-2">
                    <Text className="text-body font-semibold text-paper">{g.title}</Text>
                    <Text className="text-detail text-muted">
                      {playedText(playedCount(g.episodes), g.episodes.length)}
                    </Text>
                  </View>
                  <View style={{ width: 160 }}>
                    <Strip groups={[g]} height={6} />
                  </View>
                </View>
                <Icon name={row.open ? 'up' : 'down'} size={20} color={colors.soft} />
              </Pressable>
            );
          }
          const e = row.episode;
          return (
            <EpisodeRow
              episode={e}
              onPlay={() => play(e)}
              onMenu={() => setMenu(e)}
              onMark={() => mark([e.location], e.status !== 'played')}
              onSwipe={() => swipeMark(e)}
            />
          );
        }}
      />
      <ActionSheet
        title={menu === null ? null : menu === 'show' ? (book?.title ?? '') : menu.title}
        actions={menu === null ? [] : menu === 'show' ? showActions : episodeActions(menu)}
        onClose={() => setMenu(null)}
      />
      <UndoBar notice={notice} onDone={clearNotice} bottom={insets.bottom} />
    </>
  );
}

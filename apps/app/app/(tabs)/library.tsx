import {
  continueListening,
  createPlaylist,
  getSettings,
  groupByProgress,
  hiddenCount,
  hideBooks,
  isKidsProfile,
  type LibraryBook,
  listBooks,
  type ListeningStatus,
  listPlaylistsWithCounts,
  listTags,
  localRoot,
  listRoots,
  listSeries,
  markNotMusic,
  musicSuggestions,
  type Series,
  setSetting,
  showInLibrary,
  SMART_PRESETS,
  type SmartRule,
  unhideBooks,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { openPlayer } from '../../src/navigation';
import { showAlert } from '../../src/dialog';
import { COLORS, Icon, IconButton } from '../../src/components/Icon';
import { BookActions } from '../../src/components/BookActions';
import { BookRow, type RowSwipe } from '../../src/components/BookRow';
import { MusicCard, MusicReview } from '../../src/components/MusicSuggestions';
import { SeriesRow } from '../../src/components/SeriesRow';
import { type UndoNotice, UndoBar } from '../../src/components/UndoBar';
import { ContinueCard } from '../../src/components/ContinueCard';
import { EmptyState, Lori } from '../../src/components/Lori';
import { Sheet } from '../../src/components/Sheet';
import { db, newId } from '../../src/db';
import { HeadphoneBanner } from '../../src/devices';
import { playBook, useLibrary } from '../../src/player';
import { activeProfile, profileId } from '../../src/profile';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { chooseFolder, scanLibrary } from '../../src/scan';
import { Pill } from '../../src/components/Pill';
import { TextButton } from '../../src/components/TextButton';
import { LIST_COLUMN } from '../../src/layout';

/** `progress` is the grouped view (M79); Title and Author are flat lists; Series lists series (M109). */
type LibraryView = 'progress' | 'title' | 'author' | 'series';

const views = (): { key: LibraryView; label: string }[] => [
  { key: 'progress', label: t('Progress') },
  { key: 'title', label: t('Title') },
  { key: 'author', label: t('Author') },
  { key: 'series', label: t('Series') },
];

/** A group's title above its books, in the grouped view. */
type GroupHeader = { group: ListeningStatus; count: number };
type SeriesItem = { series: Series };
type Row = LibraryBook | GroupHeader | SeriesItem;

const isHeader = (row: Row): row is GroupHeader => 'group' in row;
const isSeries = (row: Row): row is SeriesItem => 'series' in row;
const rowKeyOf = (row: Row) =>
  isHeader(row) ? `group:${row.group}` : isSeries(row) ? `series:${row.series.key}` : row.id;

const groupTitle = (header: GroupHeader) =>
  header.group === 'inProgress'
    ? t('In progress ({n})', { n: header.count })
    : header.group === 'notStarted'
      ? t('Not started ({n})', { n: header.count })
      : t('Finished ({n})', { n: header.count });

function GroupTitle({
  header,
  open,
  onToggle,
}: {
  header: GroupHeader;
  open: boolean;
  onToggle: () => void;
}) {
  if (header.group !== 'finished') {
    return (
      <Text accessibilityRole="header" className="px-4 pb-1 pt-4 text-sm font-semibold text-soft">
        {groupTitle(header)}
      </Text>
    );
  }
  // The only group that folds away; TalkBack and the web hear whether it is open.
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      className="mt-2 min-h-12 flex-row items-center justify-between px-4 active:bg-raised"
    >
      <Text className="text-sm font-semibold text-soft">{groupTitle(header)}</Text>
      <Icon name={open ? 'up' : 'down'} size={20} color={COLORS.soft} />
    </Pressable>
  );
}

export default function LibraryScreen() {
  const network = useNetworkState();
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<LibraryView>('progress');
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  // The spinner shows for a pull, or while a scan reads files; a scan that finds nothing new
  // (each start) stays out of sight.
  const [pulled, setPulled] = useState(false);
  const [lostFolder, setLostFolder] = useState(false);
  // The Hidden view (M77): only the books this profile hid, to bring back.
  const [showHidden, setShowHidden] = useState(false);

  // `version` is the signal to re-read the database.
  const root = useMemo(() => localRoot(db), [version]);
  // The phone's folder or any server: a rescan reads them all.
  const hasRoots = useMemo(() => listRoots(db).length > 0, [version]);
  const grouped = view === 'progress' && !showHidden;
  const bySeries = view === 'series' && !showHidden;
  // The Hidden view stays one flat list; in the grouped view each group sorts itself.
  const books = useMemo(
    () =>
      listBooks(
        db,
        profileId,
        view === 'progress' ? 'recent' : view === 'series' ? 'title' : view,
        showHidden ? 'hidden' : 'visible',
      ),
    [view, version, showHidden],
  );
  // Read again on `version`, so switching profiles shows the new listener's choice.
  const [toggled, setToggled] = useState(0);
  const finishedOpen = useMemo(
    () => getSettings(db, profileId).libraryFinishedOpen,
    [version, toggled],
  );
  const toggleFinished = useCallback(() => {
    setSetting(db, profileId, 'libraryFinishedOpen', !finishedOpen, Date.now());
    setToggled((n) => n + 1);
  }, [finishedOpen]);
  // `version` is the signal to re-read the database.
  const seriesList = useMemo(
    () => (bySeries ? listSeries(db, profileId) : []),
    [bySeries, version],
  );
  const rows = useMemo<Row[]>(() => {
    if (bySeries) return seriesList.map((series) => ({ series }));
    if (!grouped) return books;
    const groups = groupByProgress(books);
    const list: Row[] = [];
    for (const group of ['inProgress', 'notStarted', 'finished'] as const) {
      const members = groups[group];
      if (members.length === 0) continue;
      list.push({ group, count: members.length });
      if (group !== 'finished' || finishedOpen) list.push(...members);
    }
    return list;
  }, [books, grouped, finishedOpen, bySeries, seriesList]);
  // A kids profile counts only what its Hidden view can show.
  const hiddenTotal = useMemo(
    () =>
      isKidsProfile(db, profileId)
        ? listBooks(db, profileId, 'title', 'hidden').length
        : hiddenCount(db, profileId),
    [version],
  );
  const musicIds = useMemo(
    () => new Set(showHidden ? [] : musicSuggestions(db, profileId)),
    [version, showHidden],
  );
  // Only what this profile sees in its Library (a kids profile sees its shelf).
  const music = useMemo(() => books.filter((b) => musicIds.has(b.id)), [books, musicIds]);
  const next = useMemo(() => continueListening(db, profileId), [version]);
  const lists = useMemo(() => listPlaylistsWithCounts(db, profileId), [version]);
  const tags = useMemo(() => listTags(db, profileId), [version]);

  const [choosingList, setChoosingList] = useState(false);
  const makeList = (name: string, rule: SmartRule | null) => {
    setChoosingList(false);
    const id = createPlaylist(db, profileId, newId, { name, rule }, Date.now());
    refresh();
    router.push({ pathname: '/list', params: { id, rename: rule ? '' : '1' } });
  };

  const rescan = useCallback(async () => {
    setScanning({ done: 0, total: 0 });
    try {
      const result = await scanLibrary((done, total) => setScanning({ done, total }));
      setLostFolder('error' in result && result.error === 'permission');
    } catch (error) {
      showAlert(t('Scan failed'), error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(null);
      setPulled(false);
      refresh();
    }
  }, [refresh]);

  // Scan on start and whenever the folder changes.
  useEffect(() => {
    if (root) void rescan();
  }, [root?.uri, rescan]);

  // Re-picking the same folder keeps its URI, so scan here rather than wait for it to change.
  const pick = async () => {
    try {
      if (!(await chooseFolder())) return;
    } catch (error) {
      showAlert(
        t('Cannot open the folder'),
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    await rescan();
  };

  const open = useCallback(
    async (book: LibraryBook) => {
      if (book.missing) {
        showAlert(
          t('Files not found'),
          t('Lelap keeps your place until the files are back in the folder.'),
        );
        return;
      }
      try {
        await playBook(book.id);
        openPlayer(router);
      } catch (error) {
        showAlert(t('Cannot play'), error instanceof Error ? error.message : String(error));
      }
    },
    [router],
  );
  const openRow = useCallback((book: LibraryBook) => void open(book), [open]);

  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const showActions = useCallback((book: LibraryBook) => setActionBook(book), []);

  const [notice, setNotice] = useState<UndoNotice | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [reviewing, setReviewing] = useState<LibraryBook[] | null>(null);
  // Hiding never stops playback: a hidden book that plays now goes on playing.
  const hidden = useCallback(
    (list: LibraryBook[]) => {
      const ids = list.map((b) => b.id);
      setNotice({
        text:
          list.length === 1
            ? t('Hidden: {title}', { title: list[0]?.title ?? '' })
            : t('{n} items hidden.', { n: list.length }),
        undo: () => {
          unhideBooks(db, profileId, ids, Date.now());
          refresh();
        },
      });
    },
    [refresh],
  );
  const hide = useCallback(
    (book: LibraryBook) => {
      hideBooks(db, profileId, [book.id], Date.now());
      hidden([book]);
      refresh();
    },
    [hidden, refresh],
  );
  const restore = useCallback(
    (book: LibraryBook) => {
      showInLibrary(db, profileId, [book.id], Date.now());
      setNotice({ text: t('Back in the library: {title}', { title: book.title }) });
      refresh();
    },
    [refresh],
  );
  const hideSwipe = useMemo<RowSwipe>(
    () => ({ label: t('Hide'), icon: 'hide', onSwipe: hide }),
    [hide],
  );
  const showSwipe = useMemo<RowSwipe>(
    () => ({ label: t('Show in library'), icon: 'show', onSwipe: restore }),
    [restore],
  );
  const hideReviewed = (hide: LibraryBook[], keep: LibraryBook[]) => {
    setReviewing(null);
    const now = Date.now();
    hideBooks(
      db,
      profileId,
      hide.map((b) => b.id),
      now,
    );
    // What the listener left unticked is not music to them; it isn't suggested again.
    markNotMusic(
      db,
      profileId,
      keep.map((b) => b.id),
      now,
    );
    if (hide.length > 0) hidden(hide);
    refresh();
  };
  const dismissMusic = () => {
    markNotMusic(
      db,
      profileId,
      music.map((b) => b.id),
      Date.now(),
    );
    refresh();
  };

  // Stable, so a refresh redraws only the rows whose book changed (BookRow is memoised).
  const offline = network.isConnected === false;
  const openSeries = useCallback(
    (series: Series) => router.push({ pathname: '/series', params: { key: series.key } }),
    [router],
  );
  const renderRow = useCallback(
    ({ item }: { item: Row }) =>
      isSeries(item) ? (
        <SeriesRow series={item.series} onOpen={openSeries} />
      ) : isHeader(item) ? (
        <GroupTitle header={item} open={finishedOpen} onToggle={toggleFinished} />
      ) : (
        <BookRow
          book={item}
          onOpen={openRow}
          onLongPress={showActions}
          swipe={showHidden ? showSwipe : hideSwipe}
          unavailable={offline && item.source !== 'local' && !item.downloaded}
        />
      ),
    [
      openRow,
      showActions,
      offline,
      showHidden,
      showSwipe,
      hideSwipe,
      finishedOpen,
      toggleFinished,
      openSeries,
    ],
  );

  if (!hasRoots && books.length === 0 && hiddenTotal === 0 && !showHidden) {
    const kids = activeProfile()?.kids === true;
    return (
      <ScrollView
        className="flex-1 bg-night"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 24,
          padding: 32,
          paddingTop: insets.top + 32,
        }}
      >
        <Lori size={150} />
        <Text accessibilityRole="header" className="text-center text-2xl font-semibold text-paper">
          {t('Your audiobooks')}
        </Text>
        {kids ? (
          <Text className="max-w-xl text-center text-soft">
            {t('Ask a grown-up to put books on your shelf.')}
          </Text>
        ) : (
          <>
            <Text className="max-w-xl text-center text-soft">
              {LOCAL_FOLDERS
                ? t(
                    'Choose the folder on this phone that holds your audiobooks, or add a server. Lelap plays them where they are. Books you play from Home, Discover and Search appear here too.',
                  )
                : t(
                    'Add a server with your audiobooks. Books you play from Home, Discover and Search appear here too. Local folders are in the Android app.',
                  )}
            </Text>
            {LOCAL_FOLDERS && (
              <Pressable
                onPress={() => void pick()}
                accessibilityRole="button"
                className="min-h-12 justify-center rounded-full bg-amber px-6 py-3 active:opacity-80"
              >
                <Text className="font-semibold text-ink">{t('Choose your audiobooks folder')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push('/server')}
              accessibilityRole="button"
              className={`min-h-12 justify-center rounded-full px-6 py-3 ${LOCAL_FOLDERS ? 'border border-line active:bg-raised' : 'bg-amber active:opacity-80'}`}
            >
              <Text className={LOCAL_FOLDERS ? 'text-amber' : 'font-semibold text-ink'}>
                {t('Add a server')}
              </Text>
            </Pressable>
          </>
        )}
        <TextButton text={t('Free books on Home')} onPress={() => router.navigate('/')} />
      </ScrollView>
    );
  }

  // The title and the offline banner stay put above the list, so neither can slide under the
  // status bar when the banner comes and goes.
  return (
    <View style={{ ...LIST_COLUMN, paddingTop: insets.top + 12 }} className="flex-1 gap-3 bg-night">
      <View className="flex-row items-center justify-between px-4">
        <Text accessibilityRole="header" className="text-3xl font-semibold text-paper">
          {t('Library')}
        </Text>
        <View className="flex-row">
          {hasRoots && (
            <IconButton
              name="rescan"
              label={scanning ? t('Scanning…') : t('Rescan')}
              color={scanning ? COLORS.muted : COLORS.soft}
              onPress={() => {
                if (scanning) return;
                setPulled(true);
                void rescan();
              }}
            />
          )}
          <IconButton
            name="bookmark"
            label={t('Bookmarks')}
            color={COLORS.soft}
            onPress={() => router.push('/bookmarks')}
          />
          <IconButton
            name="settings"
            label={t('Settings')}
            color={COLORS.soft}
            onPress={() => router.push('/settings')}
          />
        </View>
      </View>
      {network.isConnected === false && (
        <View className="mx-4 flex-row items-center gap-3 rounded-xl bg-[#2b2414] px-4 py-3">
          <Icon name="plane" size={20} color="#f7d9a0" />
          <Text className="flex-1 text-sm text-[#f7d9a0]">
            Offline. Everything on this {Platform.OS === 'web' ? 'device' : 'phone'} works; progress
            syncs when you’re back online.
          </Text>
        </View>
      )}
      <HeadphoneBanner className="mx-4" />
      {/* Rows grow with the system text size, so there is no fixed height to give getItemLayout.
          A smaller window than the default 21 screens keeps 10,000 books light to scroll. */}
      <FlatList
        data={rows}
        keyExtractor={rowKeyOf}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={9}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <RefreshControl
            refreshing={scanning !== null && (pulled || scanning.total > 0)}
            onRefresh={() => {
              setPulled(true);
              void rescan();
            }}
            tintColor={COLORS.amber}
          />
        }
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-4 pb-2">
            {!root && LOCAL_FOLDERS && !activeProfile()?.kids && (
              <Pressable
                onPress={() => void pick()}
                accessibilityRole="button"
                className="mx-4 rounded-lg border border-line p-3 active:bg-raised"
              >
                <Text className="text-soft">{t('Have audiobooks on this phone?')}</Text>
                <Text className="mt-1 font-semibold text-amber">
                  {t('Choose your audiobooks folder')}
                </Text>
              </Pressable>
            )}
            {lostFolder && (
              <Pressable
                onPress={() => void pick()}
                accessibilityRole="button"
                className="mx-4 rounded-lg border border-danger p-3"
              >
                <Text className="text-danger">
                  {t('Lelap can no longer read your audiobooks folder.')}
                </Text>
                <Text className="mt-1 font-semibold text-paper">{t('Choose folder')}</Text>
              </Pressable>
            )}
            {scanning !== null && scanning.total > 0 && (
              <Text className="px-4 text-sm text-muted">
                {t('Scanning… {done} of {total}', { done: scanning.done, total: scanning.total })}
              </Text>
            )}
            {!showHidden && music.length > 0 && (
              <MusicCard
                count={music.length}
                onReview={() => setReviewing(music)}
                onDismiss={dismissMusic}
              />
            )}
            {!showHidden && next && <ContinueCard book={next} onPress={() => void open(next)} />}
            {!showHidden && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}
              >
                {lists.map(({ list, count }) => (
                  <Pressable
                    key={list.id}
                    onPress={() => router.push({ pathname: '/list', params: { id: list.id } })}
                    accessibilityRole="button"
                    className="min-h-12 w-40 flex-row items-center gap-2.5 rounded-xl bg-raised p-2.5 active:opacity-80"
                  >
                    <View
                      className={`h-10 w-10 items-center justify-center rounded-lg ${list.rule ? 'bg-[#2d3a63]' : 'bg-amber'}`}
                    >
                      <Icon
                        name={list.rule ? 'moon' : 'chapters'}
                        size={20}
                        color={list.rule ? '#dce3f5' : COLORS.ink}
                      />
                    </View>
                    <View className="flex-1">
                      <Text numberOfLines={1} className="text-sm font-semibold text-paper">
                        {list.name}
                      </Text>
                      <Text className="text-xs text-muted">
                        {count} · {list.rule ? t('smart list') : t('list')}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setChoosingList(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('New list')}
                  className="min-h-12 w-28 flex-row items-center justify-center gap-1 rounded-xl border border-dashed border-line p-2.5 active:bg-raised"
                >
                  <Icon name="plus" size={16} color={COLORS.muted} />
                  <Text className="text-sm text-muted">{t('List')}</Text>
                </Pressable>
              </ScrollView>
            )}
            {!showHidden && tags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
              >
                {tags.map(({ tag }) => (
                  <Pill
                    key={tag}
                    onPress={() => router.push({ pathname: '/list', params: { tag } })}
                    className="rounded-full border border-line px-3 py-1.5 active:bg-raised"
                  >
                    <Text className="text-sm text-paper">
                      <Text className="text-muted"># </Text>
                      {tag}
                    </Text>
                  </Pill>
                ))}
              </ScrollView>
            )}
            <View className="flex-row flex-wrap gap-2 px-4">
              {views().map((s) => (
                <Pill
                  key={s.key}
                  onPress={() => setView(s.key)}
                  accessibilityState={{ selected: view === s.key }}
                  aria-selected={view === s.key}
                  className={`rounded-full border px-3 py-1 ${view === s.key ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={view === s.key ? 'text-ink' : 'text-soft'}>{s.label}</Text>
                </Pill>
              ))}
              {(hiddenTotal > 0 || showHidden) && (
                <Pill
                  onPress={() => setShowHidden(!showHidden)}
                  accessibilityState={{ selected: showHidden }}
                  aria-selected={showHidden}
                  className={`flex-row items-center gap-1 rounded-full border px-3 py-1 ${showHidden ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Icon name="hide" size={16} color={showHidden ? COLORS.ink : COLORS.soft} />
                  <Text className={showHidden ? 'text-ink' : 'text-soft'}>
                    {t('Hidden ({n})', { n: hiddenTotal })}
                  </Text>
                </Pill>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          showHidden ? (
            <EmptyState
              title={t('Nothing hidden')}
              hint={t('Swipe a book to the left, or press and hold it, to hide it here.')}
            />
          ) : bySeries && books.length > 0 ? (
            <EmptyState
              title={t('No series yet.')}
              hint={t(
                'Books show here when their tags, their server or their add-on name a series.',
              )}
            />
          ) : scanning === null ? (
            <EmptyState
              title={
                root ? t('No audio files in {name}.', { name: root.name }) : t('Nothing here yet.')
              }
              hint={
                root
                  ? t('Lori is saving his energy. Add audiobooks to the folder, then pull down.')
                  : t(
                      'Lori is saving his energy. Books you play from Home, Discover and Search land here.',
                    )
              }
            />
          ) : undefined
        }
        renderItem={renderRow}
      />
      <Sheet visible={choosingList} title={t('New list')} onClose={() => setChoosingList(false)}>
        <ScrollView>
          {[{ name: t('Hand-made list'), rule: null }, ...SMART_PRESETS].map((preset) => (
            <Pressable
              key={preset.name}
              onPress={() => makeList(preset.rule ? preset.name : t('New list'), preset.rule)}
              accessibilityRole="button"
              className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-line"
            >
              <Icon name={preset.rule ? 'moon' : 'chapters'} size={22} color={COLORS.soft} />
              <View>
                <Text className="text-paper">{preset.name}</Text>
                <Text className="text-xs text-muted">
                  {preset.rule
                    ? t('Smart list: fills itself')
                    : t('You pick the books and their order')}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
      <BookActions
        book={actionBook}
        onClose={() => setActionBook(null)}
        onChanged={refresh}
        onHidden={(book) => hidden([book])}
      />
      <MusicReview books={reviewing} onClose={() => setReviewing(null)} onHide={hideReviewed} />
      <UndoBar notice={notice} onDone={clearNotice} />
    </View>
  );
}

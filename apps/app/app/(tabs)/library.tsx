import {
  continueListening,
  createPlaylist,
  type LibraryBook,
  type LibrarySort,
  listBooks,
  listPlaylists,
  listTags,
  localRoot,
  playlistBooks,
  SMART_PRESETS,
  type SmartRule,
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

import { showAlert } from '../../src/dialog';
import { COLORS, Icon, IconButton } from '../../src/components/Icon';
import { BookActions } from '../../src/components/BookActions';
import { BookRow } from '../../src/components/BookRow';
import { ContinueCard } from '../../src/components/ContinueCard';
import { Sheet } from '../../src/components/Sheet';
import { db, newId } from '../../src/db';
import { HeadphoneBanner } from '../../src/devices';
import { playBook, useLibrary } from '../../src/player';
import { activeProfile, profileId } from '../../src/profile';
import { LOCAL_FOLDERS } from '../../src/platform/library';
import { chooseFolder, scanLibrary } from '../../src/scan';

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
];

export default function LibraryScreen() {
  const network = useNetworkState();
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [lostFolder, setLostFolder] = useState(false);

  // `version` is the signal to re-read the database.
  const root = useMemo(() => localRoot(db), [version]);
  const books = useMemo(() => listBooks(db, profileId, sort), [sort, version]);
  const next = useMemo(() => continueListening(db, profileId), [version]);
  const lists = useMemo(
    () =>
      listPlaylists(db, profileId).map((list) => ({
        list,
        count: playlistBooks(db, profileId, list).length,
      })),
    [version],
  );
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
      showAlert('Scan failed', error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(null);
      refresh();
    }
  }, [refresh]);

  // Scan on start and whenever the folder changes.
  useEffect(() => {
    if (root) void rescan();
  }, [root?.uri, rescan]);

  // Re-picking the same folder keeps its URI, so scan here rather than wait for it to change.
  const pick = async () => {
    if (await chooseFolder()) await rescan();
  };

  const open = async (book: LibraryBook) => {
    if (book.missing) {
      showAlert(
        'Files not found',
        'Lelap keeps your place until the files are back in the folder.',
      );
      return;
    }
    try {
      await playBook(book.id);
      router.push('/player');
    } catch (error) {
      showAlert('Cannot play', error instanceof Error ? error.message : String(error));
    }
  };

  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const showActions = useCallback((book: LibraryBook) => setActionBook(book), []);

  if (!root && books.length === 0) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 items-center justify-center gap-6 bg-night p-8"
      >
        <Text className="text-center text-2xl font-semibold text-paper">Your audiobooks</Text>
        {LOCAL_FOLDERS ? (
          <>
            <Text className="text-center text-soft">
              Choose the folder on this phone that holds your audiobooks. Lelap plays them where
              they are. Books you play from Discover and Search appear here too.
            </Text>
            <Pressable
              onPress={() => void pick()}
              className="rounded-full bg-amber px-6 py-3 active:opacity-80"
            >
              <Text className="font-semibold text-ink">Choose your audiobooks folder</Text>
            </Pressable>
          </>
        ) : (
          <Text className="text-center text-soft">
            Books you play from Home, Discover and Search appear here. Local folders are in the
            Android app.
          </Text>
        )}
      </View>
    );
  }

  // The title and the offline banner stay put above the list, so neither can slide under the
  // status bar when the banner comes and goes.
  return (
    <View style={{ paddingTop: insets.top + 12 }} className="flex-1 gap-3 bg-night">
      <View className="flex-row items-center justify-between px-4">
        <Text className="text-3xl font-semibold text-paper">Library</Text>
        <IconButton
          name="settings"
          label="Settings"
          color={COLORS.soft}
          onPress={() => router.push('/settings')}
        />
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
      <FlatList
        data={books}
        keyExtractor={(b) => b.id}
        refreshControl={
          <RefreshControl
            refreshing={scanning !== null}
            onRefresh={() => void rescan()}
            tintColor="#f5b041"
          />
        }
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-4 pb-2">
            {!root && LOCAL_FOLDERS && !activeProfile()?.kids && (
              <Pressable
                onPress={() => void pick()}
                className="mx-4 rounded-lg border border-line p-3 active:bg-raised"
              >
                <Text className="text-soft">Have audiobooks on this phone?</Text>
                <Text className="mt-1 font-semibold text-amber">Choose your audiobooks folder</Text>
              </Pressable>
            )}
            {lostFolder && (
              <Pressable
                onPress={() => void pick()}
                className="mx-4 rounded-lg border border-danger p-3"
              >
                <Text className="text-danger">
                  Lelap can no longer read your audiobooks folder.
                </Text>
                <Text className="mt-1 font-semibold text-paper">Choose folder</Text>
              </Pressable>
            )}
            {scanning !== null && scanning.total > 0 && (
              <Text className="px-4 text-sm text-muted">
                Scanning… {scanning.done} of {scanning.total}
              </Text>
            )}
            {next && <ContinueCard book={next} onPress={() => void open(next)} />}
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
                  className="w-40 flex-row items-center gap-2.5 rounded-xl bg-raised p-2.5 active:opacity-80"
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
                      {count} · {list.rule ? 'smart list' : 'list'}
                    </Text>
                  </View>
                </Pressable>
              ))}
              <Pressable
                onPress={() => setChoosingList(true)}
                accessibilityRole="button"
                className="w-28 flex-row items-center justify-center gap-1 rounded-xl border border-dashed border-line p-2.5 active:bg-raised"
              >
                <Icon name="plus" size={16} color={COLORS.muted} />
                <Text className="text-sm text-muted">List</Text>
              </Pressable>
            </ScrollView>
            {tags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
              >
                {tags.map(({ tag }) => (
                  <Pressable
                    key={tag}
                    onPress={() => router.push({ pathname: '/list', params: { tag } })}
                    className="rounded-full border border-line px-3 py-1.5 active:bg-raised"
                  >
                    <Text className="text-sm text-paper">
                      <Text className="text-muted"># </Text>
                      {tag}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <View className="flex-row gap-2 px-4">
              {SORTS.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => setSort(s.key)}
                  className={`rounded-full border px-3 py-1 ${sort === s.key ? 'border-amber bg-amber' : 'border-line'}`}
                >
                  <Text className={sort === s.key ? 'text-ink' : 'text-soft'}>{s.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          scanning === null ? (
            <Text className="px-4 pt-8 text-center text-muted">
              {root ? `No audio files in ${root.name}.` : 'Nothing here yet.'}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <BookRow
            book={item}
            onOpen={(b) => void open(b)}
            onLongPress={showActions}
            unavailable={
              network.isConnected === false && item.source !== 'local' && !item.downloaded
            }
          />
        )}
      />
      <Sheet visible={choosingList} title="New list" onClose={() => setChoosingList(false)}>
        <ScrollView>
          {[{ name: 'Hand-made list', rule: null }, ...SMART_PRESETS].map((preset) => (
            <Pressable
              key={preset.name}
              onPress={() => makeList(preset.rule ? preset.name : 'New list', preset.rule)}
              className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-line"
            >
              <Icon name={preset.rule ? 'moon' : 'chapters'} size={22} color={COLORS.soft} />
              <View>
                <Text className="text-paper">{preset.name}</Text>
                <Text className="text-xs text-muted">
                  {preset.rule ? 'Smart list: fills itself' : 'You pick the books and their order'}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
      <BookActions book={actionBook} onClose={() => setActionBook(null)} onChanged={refresh} />
    </View>
  );
}

import {
  continueListening,
  type LibraryBook,
  type LibrarySort,
  listBooks,
  removeStreamedBook,
  schema,
  setFinished,
} from '@lelap/core';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookRow } from '../../src/components/BookRow';
import { ContinueCard } from '../../src/components/ContinueCard';
import { db } from '../../src/db';
import { deleteDownload, startDownload } from '../../src/downloads';
import { playBook, useLibrary } from '../../src/player';
import { profileId } from '../../src/profile';
import { chooseFolder, scanLibrary } from '../../src/scan';

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
];

export default function LibraryScreen() {
  const { version, refresh } = useLibrary();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
  const [lostFolder, setLostFolder] = useState(false);

  // `version` is the signal to re-read the database.
  const root = useMemo(() => db.select().from(schema.libraryRoots).get(), [version]);
  const books = useMemo(() => listBooks(db, profileId, sort), [sort, version]);
  const next = useMemo(() => continueListening(db, profileId), [version]);

  const rescan = useCallback(async () => {
    setScanning({ done: 0, total: 0 });
    try {
      const result = await scanLibrary((done, total) => setScanning({ done, total }));
      setLostFolder('error' in result && result.error === 'permission');
    } catch (error) {
      Alert.alert('Scan failed', error instanceof Error ? error.message : String(error));
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
      Alert.alert(
        'Files not found',
        'Lelap keeps your place until the files are back in the folder.',
      );
      return;
    }
    try {
      await playBook(book.id);
      router.push('/player');
    } catch (error) {
      Alert.alert('Cannot play', error instanceof Error ? error.message : String(error));
    }
  };

  const toggleFinished = (book: LibraryBook) => {
    setFinished(db, profileId, book.id, book.finishedAt === null, Date.now());
    refresh();
  };

  const showActions = (book: LibraryBook) => {
    const finish = {
      text: book.finishedAt === null ? 'Mark as finished' : 'Mark as not finished',
      onPress: () => toggleFinished(book),
    };
    if (book.source !== 'addon') {
      toggleFinished(book);
      return;
    }
    const download = book.downloaded
      ? { text: 'Remove download', onPress: () => void deleteDownload(book.id).finally(refresh) }
      : {
          text: 'Download',
          onPress: () =>
            void startDownload(book.id, null)
              .catch((error: unknown) =>
                Alert.alert('Download', error instanceof Error ? error.message : String(error)),
              )
              .finally(refresh),
        };
    Alert.alert(
      book.title,
      undefined,
      [
        finish,
        download,
        {
          text: 'Remove from library',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Remove from library?',
              'Your place and bookmarks in this book are removed too.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => {
                    removeStreamedBook(db, book.id);
                    refresh();
                    // Its download, if any, goes too.
                    void deleteDownload(book.id).catch(() => {});
                  },
                },
              ],
            ),
        },
        // Android shows at most three buttons; a tap outside closes the menu.
      ],
      { cancelable: true },
    );
  };

  if (!root && books.length === 0) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 items-center justify-center gap-6 bg-night p-8"
      >
        <Text className="text-center text-2xl font-semibold text-paper">Your audiobooks</Text>
        <Text className="text-center text-soft">
          Choose the folder on this phone that holds your audiobooks. Lelap plays them where they
          are. Books you play from Discover and Search appear here too.
        </Text>
        <Pressable
          onPress={() => void pick()}
          className="rounded-full bg-amber px-6 py-3 active:opacity-80"
        >
          <Text className="font-semibold text-ink">Choose your audiobooks folder</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-night">
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
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="gap-4 pb-2">
            <View className="flex-row items-center justify-between px-4">
              <Text className="text-3xl font-semibold text-paper">Library</Text>
              <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
                <Text className="text-2xl text-muted">⚙</Text>
              </Pressable>
            </View>
            {!root && (
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
          <BookRow book={item} onOpen={(b) => void open(b)} onLongPress={showActions} />
        )}
      />
    </View>
  );
}

import { listSubscriptions } from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAlert } from '../../src/dialog';
import { BookCover } from '../../src/components/BookCover';
import { db } from '../../src/db';
import { useLibrary } from '../../src/player';
import { exportOpml, importOpml, refreshPodcasts, subscribeToFeed } from '../../src/podcasts';
import { readPickedText, shareText } from '../../src/platform/files';
import { profileId } from '../../src/profile';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export default function PodcastsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { version, refresh } = useLibrary();
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // `version` is the signal to re-read the database.
  const subs = useMemo(() => listSubscriptions(db, profileId), [version]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      showAlert('Podcasts', message(error));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const add = () =>
    run(async () => {
      const podcastId = await subscribeToFeed(feedUrl);
      setFeedUrl('');
      router.push({ pathname: '/podcast', params: { id: podcastId } });
    });

  const importFile = () =>
    run(async () => {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      const result = await importOpml(await readPickedText(asset));
      showAlert(
        `${result.added} podcasts added`,
        result.failed.length > 0 ? `Could not read: ${result.failed.join(', ')}` : undefined,
      );
    });

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshPodcasts(true).catch(() => {});
    setRefreshing(false);
    refresh();
  };

  return (
    <FlatList
      className="flex-1 bg-night"
      data={subs}
      keyExtractor={(s) => s.podcastId}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor="#f5b041"
        />
      }
      ListHeaderComponent={
        <View className="gap-4 px-4 pb-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-3xl font-semibold text-paper">Podcasts</Text>
            <Pressable onPress={() => router.push('/up-next')} hitSlop={8}>
              <Text className="text-amber">Up Next</Text>
            </Pressable>
          </View>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={feedUrl}
              onChangeText={setFeedUrl}
              placeholder="Feed address (RSS)"
              placeholderTextColor="#8d8a83"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={() => void add()}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable disabled={busy || feedUrl.trim() === ''} onPress={() => void add()}>
              {busy ? (
                <ActivityIndicator color="#f5b041" />
              ) : (
                <Text className={feedUrl.trim() === '' ? 'text-muted' : 'text-amber'}>Add</Text>
              )}
            </Pressable>
          </View>
          <View className="flex-row gap-4">
            <Pressable disabled={busy} onPress={() => void importFile()}>
              <Text className="text-amber">Import OPML</Text>
            </Pressable>
            {subs.length > 0 && (
              <Pressable onPress={() => void shareText('lelap-subscriptions.opml', exportOpml())}>
                <Text className="text-amber">Export OPML</Text>
              </Pressable>
            )}
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text className="px-4 pt-8 text-center text-muted">
          Find podcasts in Search, paste a feed address, or import an OPML file from another app. A
          podcast folder in your Library can become a subscription too: long-press it there.
        </Text>
      }
      renderItem={({ item: sub }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/podcast', params: { id: sub.podcastId } })}
          className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
        >
          <BookCover uri={sub.coverUrl} title={sub.title} size={56} />
          <View className="flex-1 gap-1">
            <Text numberOfLines={2} className="text-base text-paper">
              {sub.title}
            </Text>
            <Text numberOfLines={1} className="text-sm text-muted">
              {[
                sub.author,
                sub.unplayed > 0 ? `${sub.unplayed} unplayed` : 'All played',
                sub.autoDownload ? 'Auto-download' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

import { fetchMeta, getBook, searchAll } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetcher, useAddons } from '../src/addons';
import { MetaListRow } from '../src/components/MetaCard';
import { db } from '../src/db';
import { useLibrary } from '../src/player';
import { convertFolder } from '../src/podcasts';
import { profileId } from '../src/profile';

/**
 * Turns a podcast folder from the local library into a subscription: find the podcast, then the
 * place in the folder carries over to the feed's episodes.
 */
export default function ConvertScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  const addons = useAddons();
  const { bookId = '' } = useLocalSearchParams<{ bookId?: string }>();
  const book = useMemo(() => getBook(db, profileId, bookId)?.book, [bookId]);
  const [query, setQuery] = useState(book?.title ?? '');
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const results = useQuery({
    queryKey: ['convert-search', query, addons.map((a) => a.url)],
    enabled: query.trim().length >= 2,
    queryFn: async () =>
      (await searchAll(fetcher, addons, query.trim(), ['podcast'])).flatMap((r) => r.metas),
  });

  const convert = async (url: string) => {
    setBusy(true);
    try {
      const result = await convertFolder(bookId, url);
      refresh();
      Alert.alert(
        'Subscribed',
        `${result.matched} files matched an episode; ${result.played} marked as played.`,
      );
      router.replace({ pathname: '/podcast', params: { id: result.podcastId } });
    } catch (error) {
      Alert.alert('Podcast', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (meta: MetaPreview) => {
    const found = await fetchMeta(fetcher, addons, 'podcast', meta.id).catch(() => null);
    const url = found?.meta.feed;
    if (!url) {
      Alert.alert('No feed', 'This podcast has no feed address. Paste it below instead.');
      return;
    }
    await convert(url);
  };

  return (
    <FlatList
      className="flex-1 bg-night"
      data={results.data ?? []}
      keyExtractor={(m) => m.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
      ListHeaderComponent={
        <View className="gap-3 px-4 pb-3">
          <Pressable onPress={() => router.back()} hitSlop={12} className="self-start py-2">
            <Text className="text-2xl text-muted">‹</Text>
          </Pressable>
          <Text className="text-2xl font-semibold text-paper">Subscribe to this podcast</Text>
          <Text className="text-sm text-muted">
            Find “{book?.title ?? 'this folder'}” as a podcast. Episodes before the file you are on
            are marked as played, and that episode keeps your place. The folder stays in the
            Library.
          </Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={feedUrl}
              onChangeText={setFeedUrl}
              placeholder="Or paste its feed address"
              placeholderTextColor="#8d8a83"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable
              disabled={busy || feedUrl.trim() === ''}
              onPress={() => void convert(feedUrl.trim())}
            >
              <Text className={feedUrl.trim() === '' ? 'text-muted' : 'text-amber'}>Use</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search podcasts"
            placeholderTextColor="#8d8a83"
            autoCorrect={false}
            className="rounded-lg bg-raised px-4 py-3 text-base text-paper"
          />
          {(busy || results.isFetching) && <ActivityIndicator color="#f5b041" />}
          {results.isSuccess && results.data.length === 0 && (
            <Text className="text-muted">
              No podcasts found. Podcast search needs the Catalog add-on with Podcast Index.
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => <MetaListRow meta={item} onPress={() => void pick(item)} />}
    />
  );
}

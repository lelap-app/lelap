import { APP_PROTOCOL_VERSION, fetchMeta, getBook, searchAll } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { Button } from '../src/components/Button';
import { EmptyState } from '../src/components/EmptyState';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { TextField } from '../src/components/TextField';
import { fetcher, useAddons } from '../src/addons';
import { MetaListRow } from '../src/components/MetaCard';
import { db } from '../src/db';
import { useLibrary } from '../src/player';
import { convertFolder } from '../src/podcasts';
import { profileId } from '../src/profile';
import { LIST_COLUMN } from '../src/layout';
import { useColors } from '../src/theme';

/**
 * Turns a podcast folder from the local library into a subscription: find the podcast, then the
 * place in the folder carries over to the feed's episodes.
 */
export default function ConvertScreen() {
  const colors = useColors();
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
    queryKey: ['convert-search', APP_PROTOCOL_VERSION, query, addons.map((a) => a.url)],
    enabled: query.trim().length >= 2,
    queryFn: async () =>
      (await searchAll(fetcher, addons, query.trim(), ['podcast'])).flatMap((r) => r.metas),
  });

  const convert = async (url: string) => {
    setBusy(true);
    try {
      const result = await convertFolder(bookId, url);
      refresh();
      showAlert(
        t('Subscribed'),
        t('{matched} files matched an episode; {played} marked as played.', {
          matched: result.matched,
          played: result.played,
        }),
      );
      router.replace({ pathname: '/podcast', params: { id: result.podcastId } });
    } catch (error) {
      showAlert(t('Podcast'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (meta: MetaPreview) => {
    const found = await fetchMeta(fetcher, addons, 'podcast', meta.id).catch(() => null);
    const url = found?.meta.feed;
    if (!url) {
      showAlert(t('No feed'), t('This podcast has no feed address. Paste it below instead.'));
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
      contentContainerStyle={{
        ...LIST_COLUMN,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 24,
      }}
      ListHeaderComponent={
        <View className="px-4 pb-3">
          <ScreenHeader
            title={t('Subscribe to this podcast')}
            subtitle={t(
              'Find “{title}” as a podcast. Episodes before the file you are on are marked as played, and that episode keeps your place. The folder stays in the Library.',
              { title: book?.title ?? t('this folder') },
            )}
          />
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <TextField
                value={feedUrl}
                onChangeText={setFeedUrl}
                placeholder={t('Or paste its feed address')}
                accessibilityLabel={t('Podcast feed address')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                className="flex-1"
              />
              <Button
                kind="secondary"
                size="sm"
                text={t('Use')}
                disabled={busy || feedUrl.trim() === ''}
                onPress={() => void convert(feedUrl.trim())}
              />
            </View>
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={t('Search podcasts')}
              accessibilityLabel={t('Search podcasts')}
              autoCorrect={false}
            />
            {(busy || results.isFetching) && <ActivityIndicator color={colors.amber} />}
            {results.isSuccess && results.data.length === 0 && (
              <EmptyState
                title={t('No podcasts found')}
                body={t('Podcast search needs the Open Library catalog add-on with Podcast Index.')}
              />
            )}
          </View>
        </View>
      }
      renderItem={({ item }) => <MetaListRow meta={item} onPress={() => void pick(item)} />}
    />
  );
}

import { APP_PROTOCOL_VERSION, fetchMeta, getBook, searchAll } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../src/i18n';
import { showAlert } from '../src/dialog';
import { IconButton } from '../src/components/Icon';
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
        <View className="gap-3 px-4 pb-3">
          <View className="-ms-2 self-start">
            <IconButton
              name="back"
              label={t('Back')}
              color={colors.soft}
              onPress={() => router.back()}
            />
          </View>
          <Text accessibilityRole="header" className="text-2xl font-semibold text-paper">
            {t('Subscribe to this podcast')}
          </Text>
          <Text className="text-sm text-muted">
            {t(
              'Find “{title}” as a podcast. Episodes before the file you are on are marked as played, and that episode keeps your place. The folder stays in the Library.',
              { title: book?.title ?? t('this folder') },
            )}
          </Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={feedUrl}
              onChangeText={setFeedUrl}
              placeholder={t('Or paste its feed address')}
              accessibilityLabel={t('Feed address (RSS)')}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="min-h-12 min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-paper"
            />
            <Pressable
              disabled={busy || feedUrl.trim() === ''}
              onPress={() => void convert(feedUrl.trim())}
              accessibilityRole="button"
              className="min-h-12 min-w-12 items-center justify-center px-1"
            >
              <Text className={feedUrl.trim() === '' ? 'text-muted' : 'text-amber'}>
                {t('Use')}
              </Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search podcasts')}
            accessibilityLabel={t('Search podcasts')}
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            className="rounded-lg bg-raised px-4 py-3 text-base text-paper"
          />
          {(busy || results.isFetching) && <ActivityIndicator color={colors.amber} />}
          {results.isSuccess && results.data.length === 0 && (
            <Text className="text-muted">
              {t(
                'No podcasts found. Podcast search needs the Open Library catalog add-on with Podcast Index.',
              )}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => <MetaListRow meta={item} onPress={() => void pick(item)} />}
    />
  );
}

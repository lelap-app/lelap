import {
  APP_PROTOCOL_VERSION,
  fetchMeta,
  formatSeries,
  getBook,
  linkBook,
  searchAll,
} from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
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
import { profileId } from '../src/profile';
import { LIST_COLUMN } from '../src/layout';
import { useColors } from '../src/theme';

/**
 * Match with catalog… (M56): the listener searches the add-ons' catalogs and picks the work a
 * library book is. The search starts only when they send it, with the words they chose.
 */
export default function MatchScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useLibrary();
  const addons = useAddons();
  const { bookId = '' } = useLocalSearchParams<{ bookId?: string }>();
  const book = useMemo(() => getBook(db, profileId, bookId)?.book, [bookId]);
  const [text, setText] = useState(book?.title ?? '');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const results = useQuery({
    queryKey: ['match-search', APP_PROTOCOL_VERSION, query, addons.map((a) => a.url)],
    enabled: query.length >= 2,
    queryFn: async () => {
      const seen = new Set<string>();
      return (await searchAll(fetcher, addons, query, ['audiobook']))
        .flatMap((r) => r.metas)
        .filter((m) => !seen.has(m.id) && seen.add(m.id));
    },
  });

  const pick = async (preview: MetaPreview) => {
    setBusy(true);
    try {
      // The full meta has the work's other IDs, so its other pages find the book too.
      const meta = (await fetchMeta(fetcher, addons, 'audiobook', preview.id).catch(() => null))
        ?.meta;
      const name = meta?.name ?? preview.name;
      const author = meta?.author ?? preview.author ?? null;
      linkBook(
        db,
        bookId,
        { type: 'audiobook', id: preview.id, externalIds: meta?.externalIds },
        Date.now(),
        {
          title: name,
          author,
          cover: meta?.cover ?? preview.cover ?? null,
          series: formatSeries(meta?.series),
        },
      );
      refresh();
      router.back();
    } catch (error) {
      showAlert(t('Match with catalog'), error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      className="flex-1 bg-night"
      data={query.length >= 2 ? (results.data ?? []) : []}
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
            title={t('Match with catalog')}
            subtitle={t(
              'Pick the book “{title}” is. It then shows that book’s title, author and cover, and plays from its page. Your files stay as they are.',
              { title: book?.title ?? t('this book') },
            )}
          />
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <TextField
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => setQuery(text.trim())}
                placeholder={t('Title or author')}
                accessibilityLabel={t('Search the catalogs')}
                autoCorrect={false}
                returnKeyType="search"
                className="flex-1"
              />
              <Button
                kind="secondary"
                size="sm"
                text={t('Search')}
                disabled={text.trim().length < 2}
                onPress={() => setQuery(text.trim())}
              />
            </View>
            {query.length < 2 && (
              <Text className="text-xs text-muted">
                {t('The search goes to your add-ons when you send it.')}
              </Text>
            )}
            {(busy || results.isFetching) && <ActivityIndicator color={colors.amber} />}
            {query.length >= 2 && results.isSuccess && results.data.length === 0 && (
              <EmptyState title={t('Nothing found')} body={t('Try fewer words.')} />
            )}
          </View>
        </View>
      }
      renderItem={({ item }) => <MetaListRow meta={item} onPress={() => void pick(item)} />}
    />
  );
}

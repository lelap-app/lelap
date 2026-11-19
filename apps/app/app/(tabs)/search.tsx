import { addonLabels, fetchCatalog, searchCatalogs } from '@lelap/core';
import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../src/i18n';
import { EmptyState } from '../../src/components/Lori';
import { fetcher, SHOWN_TYPES, useAddons } from '../../src/addons';
import { useAskWhenVisible, useAvailability } from '../../src/availability';
import { MetaListRow } from '../../src/components/MetaCard';
import { openItem } from '../../src/navigation';
import { useSearchFocus } from '../../src/shortcuts';
import { COLORS } from '../../src/components/Icon';
import { LIST_COLUMN } from '../../src/layout';

const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addons = useAddons();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const availability = useAvailability();
  const visible = useAskWhenVisible();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useSearchFocus(input);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // One query per search catalog, so answers show as they come and a slow or dead add-on
  // never holds the others back.
  const refs = useMemo(() => searchCatalogs(addons, SHOWN_TYPES), [addons]);
  const labels = useMemo(() => {
    const names = addonLabels(addons);
    return new Map(addons.map((a, i) => [a.url, names[i] ?? a.manifest.name]));
  }, [addons]);
  const results = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ['search', query, ref.addon.url, ref.catalog.type, ref.catalog.id],
      enabled: query.length >= 2,
      queryFn: () =>
        fetchCatalog(fetcher, ref, { search: query }).then(
          (metas) => ({ metas, error: null as string | null }),
          (error: unknown) => ({
            metas: [],
            error: error instanceof Error ? error.message : t('Search failed'),
          }),
        ),
    })),
  });

  const done = results.flatMap((r, i) => (r.data && refs[i] ? [{ ref: refs[i], ...r.data }] : []));
  const pending = query.length >= 2 && results.some((r) => r.isFetching);
  // Answers first, then the add-ons that failed.
  const sections = [
    ...done.filter((r) => r.metas.length > 0),
    ...done.filter((r) => r.error !== null),
  ].map((r) => ({
    key: `${r.ref.addon.url} ${r.ref.catalog.type} ${r.ref.catalog.id}`,
    title: labels.get(r.ref.addon.url) ?? r.ref.addon.manifest.name,
    error: r.error,
    data: r.metas,
  }));
  const asked = new Set(refs.map((r) => r.addon.url));
  const failed = new Set(done.filter((r) => r.error !== null).map((r) => r.ref.addon.url));
  const status =
    query.length < 2 || asked.size === 0
      ? null
      : pending
        ? t('Searching {addons}…', {
            addons: asked.size === 1 ? t('1 add-on') : t('{n} add-ons', { n: asked.size }),
          })
        : t('Searched {addons}', {
            addons: asked.size === 1 ? t('1 add-on') : t('{n} add-ons', { n: asked.size }),
          }) + (failed.size > 0 ? ` · ${t('{n} answered', { n: asked.size - failed.size })}` : '');
  const nothing =
    !pending && done.length > 0 && done.every((r) => r.metas.length === 0 && !r.error);

  return (
    <View className="flex-1 bg-night" style={{ ...LIST_COLUMN, paddingTop: insets.top + 12 }}>
      <Text accessibilityRole="header" className="px-4 pb-3 text-3xl font-semibold text-paper">
        {t('Search')}
      </Text>
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        placeholder={t('Title, author or podcast')}
        accessibilityLabel={t('Search')}
        placeholderTextColor={COLORS.muted}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => setQuery(text.trim())}
        className="mx-4 mb-3 rounded-lg bg-raised px-4 py-3 text-base text-paper"
      />
      {refs.length === 0 ? (
        <Text className="px-4 text-muted">
          {t('No add-on can search. Add one in Settings → Add-ons.')}
        </Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(m, index) => `${m.id} ${index}`}
          keyboardShouldPersistTaps="handled"
          {...visible}
          extraData={availability}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            status !== null ? (
              <View className="flex-row items-center gap-2 px-4">
                {pending && <ActivityIndicator size="small" color={COLORS.amber} />}
                <Text accessibilityLiveRegion="polite" className="text-xs text-muted">
                  {status}
                </Text>
              </View>
            ) : undefined
          }
          renderSectionHeader={({ section }) => (
            <View className="bg-night px-4 pb-1 pt-4">
              <Text
                accessibilityRole="header"
                className="text-xs uppercase tracking-wider text-muted"
              >
                {section.title}
              </Text>
              {section.error !== null && (
                <Text accessibilityLiveRegion="polite" className="pt-1 text-sm text-danger">
                  {section.error}
                </Text>
              )}
            </View>
          )}
          renderItem={({ item }) => (
            <MetaListRow
              meta={item}
              availability={availability(item)}
              onPress={(meta) => openItem(router, meta)}
            />
          )}
          ListEmptyComponent={
            nothing ? (
              <EmptyState
                title={t('Nothing found for “{query}”.', { query })}
                hint={t('Lori looked everywhere. Try fewer words, or another spelling.')}
              />
            ) : undefined
          }
        />
      )}
    </View>
  );
}

import { addonLabels, fetchCatalog, searchCatalogs } from '@lelap/core';
import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetcher, SHOWN_TYPES, useAddons } from '../../src/addons';
import { useAskWhenVisible, useAvailability } from '../../src/availability';
import { MetaListRow } from '../../src/components/MetaCard';
import { openItem } from '../../src/navigation';

const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addons = useAddons();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const availability = useAvailability();
  const visible = useAskWhenVisible();

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
            error: error instanceof Error ? error.message : 'Search failed',
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
        ? `Searching ${asked.size === 1 ? '1 add-on' : `${asked.size} add-ons`}…`
        : `Searched ${asked.size === 1 ? '1 add-on' : `${asked.size} add-ons`}` +
          (failed.size > 0 ? ` · ${asked.size - failed.size} answered` : '');
  const nothing =
    !pending && done.length > 0 && done.every((r) => r.metas.length === 0 && !r.error);

  return (
    <View className="flex-1 bg-night" style={{ paddingTop: insets.top + 12 }}>
      <Text className="px-4 pb-3 text-3xl font-semibold text-paper">Search</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Title, author or podcast"
        placeholderTextColor="#8d8a83"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => setQuery(text.trim())}
        className="mx-4 mb-3 rounded-lg bg-raised px-4 py-3 text-base text-paper"
      />
      {refs.length === 0 ? (
        <Text className="px-4 text-muted">
          No add-on can search. Add one in Settings → Add-ons.
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
                {pending && <ActivityIndicator size="small" color="#f5b041" />}
                <Text className="text-xs text-muted">{status}</Text>
              </View>
            ) : undefined
          }
          renderSectionHeader={({ section }) => (
            <View className="bg-night px-4 pb-1 pt-4">
              <Text className="text-xs uppercase tracking-wider text-muted">{section.title}</Text>
              {section.error !== null && (
                <Text className="pt-1 text-sm text-danger">{section.error}</Text>
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
              <Text className="px-4 pt-12 text-center text-muted">
                Nothing found for “{query}”.
              </Text>
            ) : undefined
          }
        />
      )}
    </View>
  );
}

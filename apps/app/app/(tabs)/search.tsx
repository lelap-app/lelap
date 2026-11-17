import { searchAll, searchCatalogs } from '@lelap/core';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SectionList, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetcher, SHOWN_TYPES, useAddons } from '../../src/addons';
import { MetaListRow } from '../../src/components/MetaCard';
import { openItem } from '../../src/navigation';

const DEBOUNCE_MS = 400;

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const addons = useAddons();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const hasCatalogs = useMemo(() => searchCatalogs(addons, SHOWN_TYPES).length > 0, [addons]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['search', query, addons.map((a) => a.url)],
    enabled: query.length >= 2,
    queryFn: () => searchAll(fetcher, addons, query, SHOWN_TYPES),
  });

  const sections = (results.data ?? [])
    .filter((r) => r.metas.length > 0 || r.error !== null)
    .map((r) => ({
      key: `${r.ref.addon.url} ${r.ref.catalog.id}`,
      title: r.ref.addon.manifest.name,
      error: r.error,
      data: r.metas,
    }));
  const asked = new Set((results.data ?? []).map((r) => r.ref.addon.url));
  const failed = new Set(
    (results.data ?? []).filter((r) => r.error !== null).map((r) => r.ref.addon.url),
  );
  const status =
    asked.size === 0
      ? null
      : `Searched ${asked.size === 1 ? '1 add-on' : `${asked.size} add-ons`}` +
        (failed.size > 0 ? ` · ${asked.size - failed.size} answered` : '');
  const nothing =
    results.isSuccess && (results.data ?? []).every((r) => r.metas.length === 0 && !r.error);

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
      {!hasCatalogs ? (
        <Text className="px-4 text-muted">
          No add-on can search. Add one in Settings → Add-ons.
        </Text>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(m, index) => `${m.id} ${index}`}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            status !== null && !results.isFetching ? (
              <Text className="px-4 text-xs text-muted">{status}</Text>
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
            <MetaListRow meta={item} onPress={(meta) => openItem(router, meta)} />
          )}
          ListEmptyComponent={
            results.isFetching ? (
              <ActivityIndicator color="#f5b041" className="pt-12" />
            ) : nothing ? (
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

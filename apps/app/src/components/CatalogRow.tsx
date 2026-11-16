import { type CatalogRef, fetchCatalog } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { fetcher } from '../addons';
import { MetaTile } from './MetaCard';

const TILE = 120;

export const catalogQuery = (ref: CatalogRef, extra: Record<string, string> = {}) => ({
  queryKey: ['catalog', ref.addon.url, ref.catalog.type, ref.catalog.id, extra],
  queryFn: () => fetchCatalog(fetcher, ref, extra),
});

/** One Home row: a catalog's first page as a horizontal list of covers. */
export function CatalogRow({
  catalogRef,
  onOpen,
  onMore,
}: {
  catalogRef: CatalogRef;
  onOpen: (meta: MetaPreview) => void;
  onMore: () => void;
}) {
  const { data, isPending, isError } = useQuery(catalogQuery(catalogRef));
  if (isError || (data && data.length === 0)) return null;

  return (
    <View className="gap-2">
      <Pressable onPress={onMore} className="flex-row items-baseline justify-between px-4">
        <Text className="text-lg font-semibold text-paper">{catalogRef.catalog.name}</Text>
        <Text className="text-sm text-amber">More ›</Text>
      </Pressable>
      {isPending ? (
        <View style={{ height: TILE + 40 }} className="justify-center">
          <ActivityIndicator color="#f5b041" />
        </View>
      ) : (
        <FlatList
          horizontal
          data={data}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          renderItem={({ item }) => <MetaTile meta={item} width={TILE} onPress={onOpen} />}
        />
      )}
    </View>
  );
}

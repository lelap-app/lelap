import type { MetaPreview } from '@lelap/sdk';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDuration } from '../format';
import { BookCover } from './BookCover';

/** A catalog item as a cover tile, for rows and grids. */
export const MetaTile = memo(function MetaTile({
  meta,
  width,
  onPress,
}: {
  meta: MetaPreview;
  width: number;
  onPress: (meta: MetaPreview) => void;
}) {
  return (
    <Pressable onPress={() => onPress(meta)} style={{ width }} className="gap-1 active:opacity-70">
      <BookCover uri={meta.cover} title={meta.name} size={width} />
      <Text numberOfLines={2} className="text-sm text-paper">
        {meta.name}
      </Text>
      {meta.author !== undefined && (
        <Text numberOfLines={1} className="text-xs text-muted">
          {meta.author}
        </Text>
      )}
    </Pressable>
  );
});

/** A catalog item as a list row, for search results. */
export const MetaListRow = memo(function MetaListRow({
  meta,
  onPress,
}: {
  meta: MetaPreview;
  onPress: (meta: MetaPreview) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(meta)}
      className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
    >
      <BookCover uri={meta.cover} title={meta.name} size={56} />
      <View className="flex-1 gap-1">
        <Text numberOfLines={2} className="text-base text-paper">
          {meta.name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {[meta.author, meta.durationMs ? formatDuration(meta.durationMs) : undefined]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
});

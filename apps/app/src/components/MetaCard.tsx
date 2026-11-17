import type { Availability } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { memo } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { useArtwork } from '../addons';
import { formatDuration } from '../format';
import { BookCover } from './BookCover';

const onDevice = () => (Platform.OS === 'web' ? t('On this device') : t('On this phone'));

/** The words on a badge, also used as the cover's accessibility hint. */
export function badgeLabel(availability: Availability): string {
  if (availability.kind === 'local') return onDevice();
  if (availability.kind === 'stream') return availability.addon;
  return t('Metadata only');
}

/**
 * Where an item plays from: on the device (amber), the add-on that streams it (amber outline),
 * or nowhere yet (muted outline). Nothing while the answer is still out.
 */
export function SourceBadge({ availability }: { availability: Availability | undefined }) {
  if (!availability) return null;
  const style =
    availability.kind === 'local'
      ? 'border-amber bg-amber'
      : availability.kind === 'stream'
        ? 'border-amber bg-night/85'
        : 'border-line bg-night/85';
  const text =
    availability.kind === 'local'
      ? 'text-ink'
      : availability.kind === 'stream'
        ? 'text-amber'
        : 'text-muted';
  return (
    <View className={`self-start rounded-full border px-1.5 py-px ${style}`}>
      <Text numberOfLines={1} className={`text-[10px] font-semibold ${text}`}>
        {badgeLabel(availability)}
      </Text>
    </View>
  );
}

/** A catalog item as a cover tile, for rows and grids. */
export const MetaTile = memo(function MetaTile({
  meta,
  width,
  availability,
  onPress,
  askArtwork = true,
}: {
  meta: MetaPreview;
  width: number;
  availability?: Availability | undefined;
  onPress: (meta: MetaPreview) => void;
  /** False: show only a cover the item has or an earlier request found. */
  askArtwork?: boolean;
}) {
  const cover = useArtwork(meta, { ask: askArtwork });
  return (
    <Pressable
      onPress={() => onPress(meta)}
      accessibilityRole="button"
      style={{ width }}
      className="gap-1 active:opacity-70"
    >
      <View>
        <BookCover uri={cover} title={meta.name} size={width} />
        <View className="absolute bottom-1.5 inset-x-1.5">
          <SourceBadge availability={availability} />
        </View>
      </View>
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
  availability,
  onPress,
}: {
  meta: MetaPreview;
  availability?: Availability | undefined;
  onPress: (meta: MetaPreview) => void;
}) {
  const cover = useArtwork(meta);
  return (
    <Pressable
      onPress={() => onPress(meta)}
      accessibilityRole="button"
      className="flex-row items-center gap-3 px-4 py-2 active:bg-raised"
    >
      <BookCover uri={cover} title={meta.name} size={56} />
      <View className="flex-1 gap-1">
        <Text numberOfLines={2} className="text-base text-paper">
          {meta.name}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {[meta.author, meta.durationMs ? formatDuration(meta.durationMs) : undefined]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <SourceBadge availability={availability} />
      </View>
    </Pressable>
  );
});

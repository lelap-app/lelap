import { listWanted, removeWanted } from '@lelap/core';
import type { MetaPreview } from '@lelap/sdk';
import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';

import { useAvailability } from '../availability';
import { db } from '../db';
import { showAlert } from '../dialog';
import { t } from '../i18n';
import { GOODREADS } from '../importers';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { MetaTile } from './MetaCard';
import { TextButton } from './TextButton';

const TILE = 120;
const itemKey = (m: MetaPreview) => `${m.type} ${m.id}`;

/**
 * Want to read from a Goodreads import (M102): the books on its to-read shelf that a catalog
 * knows, oldest first, until the listener clears them. No add-on lists them, so they live here.
 */
export function ImportedWantedRow({ onOpen }: { onOpen: (meta: MetaPreview) => void }) {
  const { version, refresh } = useLibrary();
  const availability = useAvailability();
  // `version` is the signal to re-read the database.
  const works = useMemo(
    () => listWanted(db, profileId).filter((w) => w.from === GOODREADS),
    [version],
  );
  if (works.length === 0) return null;
  const items: MetaPreview[] = works.flatMap((w) =>
    w.type === 'audiobook' || w.type === 'podcast' || w.type === 'episode'
      ? [
          {
            type: w.type,
            id: w.id,
            name: w.name,
            ...(w.author ? { author: w.author } : {}),
            ...(w.cover ? { cover: w.cover } : {}),
          },
        ]
      : [],
  );
  const clear = () =>
    showAlert(t('Clear Want to read from Goodreads?'), t('Import again to bring the books back.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Clear'),
        style: 'destructive',
        onPress: () => {
          for (const work of works) removeWanted(db, profileId, work);
          refresh();
        },
      },
    ]);
  return (
    <View className="gap-2">
      <View className="min-h-12 flex-row items-center justify-between gap-2 ps-4 pe-2">
        <Text accessibilityRole="header" className="flex-1 text-section font-semibold text-paper">
          {`${t('Want to read')} · Goodreads`}
        </Text>
        <TextButton
          text={t('Clear')}
          tone="muted"
          accessibilityLabel={t('Clear Want to read from Goodreads')}
          onPress={clear}
        />
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={itemKey}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        extraData={availability}
        renderItem={({ item }) => (
          <MetaTile meta={item} width={TILE} availability={availability(item)} onPress={onOpen} />
        )}
      />
    </View>
  );
}

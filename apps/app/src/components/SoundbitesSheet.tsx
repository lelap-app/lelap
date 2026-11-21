import type { FeedSoundbite } from '@lelap/core';
import { FlatList, Pressable, Text } from 'react-native';

import { hint } from '../a11y';
import { formatClock } from '../format';
import { t } from '../i18n';
import { Sheet } from './Sheet';

/** An episode's soundbites (M88): the stretches its show picked. A tap plays one and stops at its end. */
export function SoundbitesSheet({
  visible,
  soundbites,
  onPlay,
  onClose,
}: {
  visible: boolean;
  soundbites: FeedSoundbite[];
  onPlay: (soundbite: FeedSoundbite) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={t('Soundbites')} onClose={onClose}>
      <FlatList
        data={soundbites}
        keyExtractor={(s, i) => `${s.startMs}-${i}`}
        ListHeaderComponent={
          <Text className="pb-2 text-detail text-muted">
            {t('Picked by the podcast. Each plays to its end, then pauses.')}
          </Text>
        }
        renderItem={({ item, index }) => {
          const range = `${formatClock(item.startMs)}–${formatClock(item.startMs + item.durationMs)}`;
          const title = item.title ?? t('Soundbite {n}', { n: index + 1 });
          return (
            <Pressable
              onPress={() => onPlay(item)}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${range}`}
              {...hint(t('Plays this soundbite'))}
              className="min-h-12 flex-row items-center gap-3 py-2 active:opacity-60"
            >
              <Text numberOfLines={2} className="flex-1 text-paper">
                {title}
              </Text>
              <Text className="text-detail text-muted">{range}</Text>
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

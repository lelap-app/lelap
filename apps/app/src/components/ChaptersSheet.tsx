import { FlatList, Pressable, Text } from 'react-native';

import { t } from '../i18n';
import { formatClock } from '../format';
import { Sheet } from './Sheet';

export function ChaptersSheet({
  visible,
  chapters,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  chapters: { title: string; startMs: number }[];
  current: number;
  onPick: (startMs: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title={t('Chapters')} onClose={onClose}>
      <FlatList
        data={chapters}
        keyExtractor={(_, i) => String(i)}
        initialScrollIndex={Math.max(0, current)}
        getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
        renderItem={({ item, index }) => (
          <Pressable
            onPress={() => onPick(item.startMs)}
            accessibilityRole="button"
            accessibilityState={{ selected: index === current }}
            aria-selected={index === current}
            style={{ height: 48 }}
            className="flex-row items-center gap-3 active:opacity-60"
          >
            <Text
              numberOfLines={1}
              className={`flex-1 ${index === current ? 'text-amber' : 'text-paper'}`}
            >
              {item.title}
            </Text>
            <Text className="text-sm text-muted">{formatClock(item.startMs)}</Text>
          </Pressable>
        )}
      />
    </Sheet>
  );
}

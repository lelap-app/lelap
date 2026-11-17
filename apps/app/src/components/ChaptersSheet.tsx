import { FlatList, Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { formatClock } from '../format';
import type { SilenceScan } from '../silences';
import { Sheet } from './Sheet';
import { TextButton } from './TextButton';

/** Chapters found from long silences (M45): how a scan stands, and what the listener can do. */
export type FoundChapters = {
  /** The chapters shown were found from silences. */
  found: boolean;
  /** The book has no chapters and its files are on this phone. */
  canFind: boolean;
  scan: SilenceScan | undefined;
  onFind: () => void;
  onStop: () => void;
  onRemove: () => void;
};

function scanText(scan: SilenceScan | undefined): string | null {
  if (!scan) return null;
  switch (scan.state) {
    case 'waiting':
      return t('Waiting for enough battery.');
    case 'running':
      return scan.filesTotal > 1
        ? t('Listening for silences: file {n} of {total}.', {
            n: Math.min(scan.filesDone + 1, scan.filesTotal),
            total: scan.filesTotal,
          })
        : t('Listening for silences.');
    case 'done':
      return t('No long silences were found, so the book stays without chapters.');
    case 'failed':
      return scan.error
        ? t('The scan stopped: {error}', { error: scan.error })
        : t('The scan was stopped.');
  }
}

function FindChapters({ silences }: { silences: FoundChapters }) {
  const busy = silences.scan?.state === 'waiting' || silences.scan?.state === 'running';
  const status = scanText(silences.scan);
  return (
    <View className="gap-3 pb-2">
      <Text className="leading-5 text-soft">
        {t(
          'This book has no chapters. Lelap can listen for long silences in its files and start a chapter at each. It runs on this phone in the background and stops when the battery is low.',
        )}
      </Text>
      {status && (
        <Text accessibilityLiveRegion="polite" className="text-muted">
          {status}
        </Text>
      )}
      <View className="flex-row justify-end">
        {busy ? (
          <TextButton text={t('Stop')} onPress={silences.onStop} tone="muted" />
        ) : (
          <TextButton text={t('Find chapters')} onPress={silences.onFind} />
        )}
      </View>
    </View>
  );
}

export function ChaptersSheet({
  visible,
  chapters,
  current,
  onPick,
  onClose,
  silences,
}: {
  visible: boolean;
  chapters: { title: string; startMs: number }[];
  current: number;
  onPick: (startMs: number) => void;
  onClose: () => void;
  silences: FoundChapters;
}) {
  return (
    <Sheet visible={visible} title={t('Chapters')} onClose={onClose}>
      {chapters.length === 0 ? (
        silences.canFind && <FindChapters silences={silences} />
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(_, i) => String(i)}
          initialScrollIndex={Math.max(0, current)}
          getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
          ListFooterComponent={
            silences.found ? (
              <View className="flex-row items-center gap-3 pt-2">
                <Text className="flex-1 text-sm text-muted">
                  {t('Found from long silences on this phone.')}
                </Text>
                <TextButton
                  text={t('Remove')}
                  accessibilityLabel={t('Remove found chapters')}
                  onPress={silences.onRemove}
                  tone="danger"
                />
              </View>
            ) : undefined
          }
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
      )}
    </Sheet>
  );
}

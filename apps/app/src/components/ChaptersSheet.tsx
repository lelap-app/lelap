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

/** The listener's own chapters (M85): edit them, or go back to the book's. */
export type OwnChapters = {
  /** The chapters shown are the listener's own. */
  own: boolean;
  onEdit: () => void;
  onReset: () => void;
};

function scanText(scan: SilenceScan | undefined): string | null {
  if (!scan) return null;
  switch (scan.state) {
    case 'waiting':
      return scan.lowBattery ? t('Waiting for enough battery.') : t('Waiting to start.');
    case 'running':
      return t('Listening for silences.');
    case 'done':
      return t('No long silences were found, so the book stays without chapters.');
    case 'failed':
      return scan.error
        ? t('The scan stopped: {error}', { error: scan.error })
        : t('The scan was stopped.');
  }
}

/** How far a scan is through the book: a bar, with no number beside it. */
function ScanBar({ fraction }: { fraction: number }) {
  const done = Math.min(1, Math.max(0, fraction));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={t('Listening for silences.')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(done * 100) }}
      className="h-1.5 overflow-hidden rounded-full bg-line"
    >
      <View style={{ width: `${done * 100}%` }} className="h-full rounded-full bg-amber" />
    </View>
  );
}

function FindChapters({ silences }: { silences: FoundChapters }) {
  const busy = silences.scan?.state === 'waiting' || silences.scan?.state === 'running';
  const status = scanText(silences.scan);
  return (
    <View className="gap-3">
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
      {silences.scan?.state === 'running' && <ScanBar fraction={silences.scan.fraction} />}
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

/** What the chapters are, under the list, and what can be done about it. */
function Footer({ silences, own }: { silences: FoundChapters; own: OwnChapters }) {
  return (
    <View className="flex-row flex-wrap items-center gap-x-3 pt-2">
      <Text className="min-w-40 flex-1 text-sm text-muted">
        {own.own
          ? t('Your own chapters.')
          : silences.found
            ? t('Found from long silences on this phone.')
            : ''}
      </Text>
      {own.own && (
        <TextButton
          text={t('Reset')}
          accessibilityLabel={t('Back to the book’s chapters')}
          onPress={own.onReset}
          tone="muted"
        />
      )}
      {!own.own && silences.found && (
        <TextButton
          text={t('Remove')}
          accessibilityLabel={t('Remove found chapters')}
          onPress={silences.onRemove}
          tone="danger"
        />
      )}
      <TextButton text={t('Edit')} accessibilityLabel={t('Edit chapters')} onPress={own.onEdit} />
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
  own,
}: {
  visible: boolean;
  chapters: { title: string; startMs: number }[];
  current: number;
  onPick: (startMs: number) => void;
  onClose: () => void;
  silences: FoundChapters;
  own: OwnChapters;
}) {
  return (
    <Sheet visible={visible} title={t('Chapters')} onClose={onClose}>
      {chapters.length === 0 ? (
        <View className="gap-3 pb-2">
          {silences.canFind && !own.own && <FindChapters silences={silences} />}
          <Footer silences={silences} own={own} />
        </View>
      ) : (
        <FlatList
          data={chapters}
          keyExtractor={(_, i) => String(i)}
          initialScrollIndex={Math.max(0, current)}
          getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
          ListFooterComponent={<Footer silences={silences} own={own} />}
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

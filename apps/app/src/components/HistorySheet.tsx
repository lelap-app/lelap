import { bookHistory, type HistoryEntry, type HistorySource } from '@lelap/core';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { db } from '../db';
import { formatClock, formatTimeOfDay } from '../format';
import { useHistoryVersion } from '../history';
import { t } from '../i18n';
import { profileId } from '../profile';
import { EmptyState } from './EmptyState';
import { Sheet } from './Sheet';

const clockOf = (ms: number): string => {
  const d = new Date(ms);
  return formatTimeOfDay(d.getHours() * 60 + d.getMinutes());
};

/** What an entry did, in a few words. */
export function historyText(e: HistoryEntry): string {
  const from = formatClock(e.fromMs);
  const to = formatClock(e.toMs);
  switch (e.action) {
    case 'play':
      return t('Played at {place}', { place: from });
    case 'pause':
      return t('Paused at {place}', { place: from });
    case 'skip':
      return e.toMs >= e.fromMs
        ? t('Skipped forward from {from} to {to}', { from, to })
        : t('Skipped back from {from} to {to}', { from, to });
    case 'seek':
      return t('Moved from {from} to {to}', { from, to });
    case 'chapter':
      return t('Changed chapter from {from} to {to}', { from, to });
    case 'timer':
      return t('Sleep timer changed at {place}', { place: from });
    case 'sleep':
      return t('Sleep timer stopped at {place}', { place: to });
  }
}

function sourceText(source: HistorySource): string | null {
  switch (source) {
    case 'app':
      return t('in the app');
    case 'notification':
      return t('notification');
    case 'headphones':
      return t('headphones');
    case 'widget':
      return t('widget');
    case 'car':
      return t('car');
    case 'watch':
      return t('watch');
    case 'keys':
      return t('media keys');
    case 'shake':
      return t('shake');
    case 'other':
      return t('another app');
    case 'timer':
      return null;
  }
}

/**
 * The book's playback history (M138), newest first. A tap goes back to the place before that
 * action, without starting to play; nothing moves by itself.
 */
export function HistorySheet({
  visible,
  bookId,
  onPick,
  onClose,
}: {
  visible: boolean;
  bookId: string;
  onPick: (bookPositionMs: number) => void;
  onClose: () => void;
}) {
  const version = useHistoryVersion();
  // `version` and `visible` are the signals to read the log again.
  const entries = useMemo(
    () => (visible ? bookHistory(db, profileId, bookId, Date.now()) : []),
    [bookId, visible, version],
  );
  return (
    <Sheet visible={visible} title={t('History')} onClose={onClose}>
      {entries.length === 0 ? (
        <View className="pb-4">
          <EmptyState
            title={t('No history yet')}
            body={t('Plays, pauses, skips and jumps in this book show here for 30 days.')}
          />
        </View>
      ) : (
        <ScrollView className="max-h-96 pb-2">
          {entries.map((e) => {
            const source = sourceText(e.source);
            const line = [clockOf(e.at), historyText(e), source].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={e.id}
                onPress={() => onPick(e.fromMs)}
                accessibilityRole="button"
                accessibilityHint={t('Goes to {place}', { place: formatClock(e.fromMs) })}
                className="min-h-12 justify-center rounded-lg px-2 py-2 active:bg-night"
              >
                <Text className="text-paper">{line}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

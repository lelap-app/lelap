import { useEffect } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';

import { t } from '../i18n';
import { TextButton } from './TextButton';

/** What the bar says, and what Undo takes back; none for a plain notice. */
export type UndoNotice = { text: string; undo?: () => void };

/** How long the bar stays; long enough to reach Undo with TalkBack. */
const SHOWN_MS = 8000;

/** A bar at the bottom of the screen after a quick change, such as hiding a book. */
export function UndoBar({ notice, onDone }: { notice: UndoNotice | null; onDone: () => void }) {
  useEffect(() => {
    if (!notice) return;
    // TalkBack hears it at once, so the listener knows the row went away and why.
    AccessibilityInfo.announceForAccessibility(notice.text);
    const timer = setTimeout(onDone, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [notice, onDone]);
  if (!notice) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="absolute inset-x-4 bottom-4 min-h-12 flex-row items-center gap-3 rounded-xl bg-raised py-1 pe-2 ps-4 shadow-lg"
    >
      <Text className="flex-1 text-paper">{notice.text}</Text>
      {notice.undo && (
        <TextButton
          text={t('Undo')}
          onPress={() => {
            notice.undo?.();
            onDone();
          }}
        />
      )}
    </View>
  );
}

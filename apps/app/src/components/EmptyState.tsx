import { Text, View } from 'react-native';

import { Button } from './Button';
import { Lori } from './Lori';

/**
 * An empty list or screen, or one that failed: a title saying what's missing, a line on what to
 * do, and one button for it. Lori sleeps over whole-screen empties; sheets and sections leave her
 * out and keep the same type.
 */
export function EmptyState({
  title,
  body,
  action,
  lori = false,
}: {
  title: string;
  body?: string | undefined;
  action?: { label: string; onPress: () => void } | undefined;
  lori?: boolean;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      className={`items-center gap-2 px-6 ${lori ? 'pt-12' : 'pt-6'}`}
    >
      {lori && <Lori size={104} />}
      <Text className="text-center text-body font-semibold text-paper">{title}</Text>
      {body !== undefined && (
        <Text className="max-w-xs text-center text-detail text-muted">{body}</Text>
      )}
      {action && (
        <Button kind="secondary" text={action.label} onPress={action.onPress} className="mt-2" />
      )}
    </View>
  );
}

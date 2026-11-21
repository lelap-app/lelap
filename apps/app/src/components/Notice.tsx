import { Text, View } from 'react-native';

import { useColors } from '../theme';
import { Icon, type IconName } from './Icon';

/**
 * A line the listener should see above a screen's content, such as being offline. Raised surface,
 * theme line and accent icon, so it follows every theme; a warning has an accent border and is
 * announced.
 */
export function Notice({
  tone = 'info',
  icon,
  text,
  large = false,
  className = '',
}: {
  tone?: 'info' | 'warning';
  icon: IconName;
  text: string;
  /** For the car screen, read at arm's length. */
  large?: boolean;
  className?: string;
}) {
  const colors = useColors();
  return (
    <View
      {...(tone === 'warning' ? { accessibilityRole: 'alert' as const } : {})}
      className={`flex-row items-center gap-3 rounded-xl border bg-raised px-4 py-3 ${tone === 'warning' ? 'border-amber' : 'border-line'} ${className}`}
    >
      <View aria-hidden>
        <Icon name={icon} size={large ? 28 : 20} color={colors.amber} />
      </View>
      <Text className={`flex-1 ${large ? 'text-section' : 'text-detail'} text-paper`}>{text}</Text>
    </View>
  );
}

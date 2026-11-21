import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { t } from '../i18n';
import { useColors } from '../theme';
import { IconButton } from './Icon';

/**
 * The top of every pushed screen: a 48-point row with Back (or Close in a side column) and an
 * optional action on the right, then the title and an optional line under it. The screen puts it
 * first, at `insets.top + 8`, so the title sits at the same height on every screen.
 */
export function ScreenHeader({
  title,
  subtitle,
  back = 'back',
  onBack,
  backLabel,
  action,
  inGap = false,
  children,
}: {
  /** Left out while the screen has nothing to name yet, such as a series still loading. */
  title?: string | undefined;
  subtitle?: string | undefined;
  back?: 'back' | 'close';
  /** Router back when left out. */
  onBack?: () => void;
  /** Names Back or Close when the screen needs more, such as “Close transcript”. */
  backLabel?: string;
  action?: ReactNode;
  /**
   * The screen's content sets a gap of its own between its parts, the header included; the
   * header then adds no space under itself, so the title sits as far from what follows as in
   * Settings.
   */
  inGap?: boolean;
  /** Anything that belongs to the header under the subtitle, such as a book's title. */
  children?: ReactNode;
}) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View className={inGap ? 'gap-2' : 'gap-2 pb-4'}>
      <View className="-ms-2 h-12 flex-row items-center justify-between">
        <IconButton
          name={back}
          label={backLabel ?? (back === 'close' ? t('Close') : t('Back'))}
          color={colors.soft}
          onPress={onBack ?? (() => router.back())}
        />
        {action}
      </View>
      {title !== undefined && (
        <Text accessibilityRole="header" className="text-title font-semibold text-paper">
          {title}
        </Text>
      )}
      {subtitle !== undefined && <Text className="text-detail text-muted">{subtitle}</Text>}
      {children}
    </View>
  );
}

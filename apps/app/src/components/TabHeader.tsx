import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { t } from '../i18n';
import { startNav } from '../navTiming';
import { useColors } from '../theme';
import { IconButton } from './Icon';

/**
 * The top of each of the five tabs (M149): the title on a 48-point row, the tab's own buttons,
 * then Settings last, so every tab reaches Settings from the same place. The tab puts it first,
 * at `insets.top + 12`.
 */
export function TabHeader({ title, children }: { title: string; children?: ReactNode }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View className="min-h-12 flex-row items-center justify-between gap-2 px-4">
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        className="shrink text-title font-semibold text-paper"
      >
        {title}
      </Text>
      <View className="flex-row items-center">
        {children}
        <IconButton
          name="settings"
          label={t('Settings')}
          color={colors.soft}
          onPress={() => {
            startNav('settings/index');
            router.push('/settings');
          }}
        />
      </View>
    </View>
  );
}

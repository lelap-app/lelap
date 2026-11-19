import { Text, View } from 'react-native';

import { t } from '../i18n';
import { stepList, stopList, useFollowedList, useLibrary } from '../player';
import { IconButton } from './Icon';
import { useColors } from '../theme';

/**
 * In the player while a list plays (M112): which list, what comes next, the list's previous and
 * next item, and a way to stop following it.
 */
export function ListBanner({ className = '' }: { className?: string }) {
  const colors = useColors();
  const following = useFollowedList();
  const { refresh } = useLibrary();
  if (!following) return null;
  const { list, next, previous } = following;
  const step = (forward: boolean) => void stepList(forward).finally(refresh);
  return (
    <View
      accessibilityLiveRegion="polite"
      className={`flex-row items-center gap-1 rounded-xl border border-line bg-raised ps-3 ${className}`}
    >
      <View className="flex-1 py-2">
        <Text numberOfLines={1} className="text-xs uppercase tracking-widest text-muted">
          {t('From the list “{name}”', { name: list.name })}
        </Text>
        <Text numberOfLines={1} className="text-sm text-soft">
          {next ? t('Next: {title}', { title: next.title }) : t('Last in the list')}
        </Text>
      </View>
      {previous && (
        <IconButton
          name="previous"
          label={t('Previous in list')}
          size={20}
          color={colors.soft}
          onPress={() => step(false)}
        />
      )}
      {next && (
        <IconButton
          name="next"
          label={t('Next in list')}
          size={20}
          color={colors.soft}
          onPress={() => step(true)}
        />
      )}
      <IconButton
        name="close"
        label={t('Stop playing the list')}
        size={20}
        color={colors.muted}
        onPress={() => void stopList().finally(refresh)}
      />
    </View>
  );
}

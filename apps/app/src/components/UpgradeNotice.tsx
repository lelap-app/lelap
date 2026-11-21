import type { AddonBlock } from '@lelap/core';
import { Text, View } from 'react-native';

import { t } from '../i18n';
import { updateLelap } from '../updates';
import { TextButton } from './TextButton';

/**
 * What an add-on that won't work with this app shows (M156): “Needs a newer Lelap” when its
 * `minProtocolVersion` is above the app's revision, “Update Lelap to use …” when it answered
 * `426`, with the add-on's own short note, and Update.
 */
export function UpgradeNotice({
  name,
  block,
  className = '',
}: {
  name: string;
  block: AddonBlock;
  className?: string;
}) {
  const line =
    block.kind === 'minimum' ? t('Needs a newer Lelap') : t('Update Lelap to use {name}', { name });
  return (
    <View className={`flex-row items-center gap-3 ${className}`}>
      <View className="flex-1 gap-0.5">
        <Text className="text-detail text-amber">{line}</Text>
        {block.kind === 'refused' && block.note !== null && (
          <Text className="text-caption text-muted">{block.note}</Text>
        )}
      </View>
      <TextButton
        text={t('Update')}
        accessibilityLabel={t('Update Lelap to use {name}', { name })}
        onPress={() => void updateLelap().catch(() => {})}
      />
    </View>
  );
}

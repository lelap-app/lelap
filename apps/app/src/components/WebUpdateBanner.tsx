import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { useWebUpdate } from '../webUpdate';
import { TextButton } from './TextButton';

/** The web app's offer of a newly deployed build; nothing on a phone. */
export function WebUpdateBanner() {
  const update = useWebUpdate();
  const insets = useSafeAreaInsets();
  if (!update) return null;
  return (
    <View
      style={{ top: insets.top + 8 }}
      accessibilityLiveRegion="polite"
      className="absolute inset-x-3 flex-row flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-raised p-3"
    >
      <Text className="min-w-24 flex-1 text-paper">{t('A new version of Lelap is ready.')}</Text>
      <TextButton text={t('Not now')} tone="muted" onPress={update.dismiss} />
      <TextButton strong text={t('Reload')} onPress={update.reload} />
    </View>
  );
}

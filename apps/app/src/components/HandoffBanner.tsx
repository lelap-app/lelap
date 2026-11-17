import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { openPlayer } from '../navigation';
import { formatClock } from '../format';
import * as audio from '../platform/audio';
import { playBook, seekToBookPosition } from '../player';
import { useHandoffOffer } from '../sync';
import { TextButton } from './TextButton';

/** “Continue where the laptop was?” after another device saved a newer place. */
export function HandoffBanner() {
  const [offer, dismiss] = useHandoffOffer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!offer) return null;

  const accept = async () => {
    dismiss();
    const state = await audio.getState();
    // The saved place is already the other device's; a loaded book has to jump there.
    if (state.bookId === offer.bookId) {
      await seekToBookPosition(offer.bookId, offer.positionMs);
      await audio.play();
    } else {
      await playBook(offer.bookId);
    }
    openPlayer(router);
  };

  return (
    <View
      style={{ top: insets.top + 8 }}
      accessibilityLiveRegion="polite"
      className="absolute inset-x-3 flex-row items-center gap-3 rounded-xl border border-line bg-raised p-3"
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-paper">
          {t('Continue from {name}?', { name: offer.deviceName })}
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {offer.title} · {formatClock(offer.positionMs)}
        </Text>
      </View>
      <TextButton text={t('Not now')} tone="muted" onPress={dismiss} />
      <TextButton text={t('Continue')} onPress={() => void accept()} />
    </View>
  );
}

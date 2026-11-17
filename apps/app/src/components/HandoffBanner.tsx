import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { formatClock } from '../format';
import * as audio from '../platform/audio';
import { playBook, seekToBookPosition } from '../player';
import { useHandoffOffer } from '../sync';

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
    router.push('/player');
  };

  return (
    <View
      style={{ top: insets.top + 8 }}
      className="absolute left-3 right-3 flex-row items-center gap-3 rounded-xl border border-line bg-raised p-3"
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-paper">
          Continue from {offer.deviceName}?
        </Text>
        <Text numberOfLines={1} className="text-sm text-muted">
          {offer.title} · {formatClock(offer.positionMs)}
        </Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={8}>
        <Text className="text-muted">{t('Not now')}</Text>
      </Pressable>
      <Pressable onPress={() => void accept()} hitSlop={8}>
        <Text className="font-semibold text-amber">{t('Continue')}</Text>
      </Pressable>
    </View>
  );
}

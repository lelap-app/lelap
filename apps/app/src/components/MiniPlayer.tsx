import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { FadeIn } from './Motion';
import { COLORS, Icon } from './Icon';
import { useWide } from '../layout';
import * as audio from '../platform/audio';
import { playerProfile, usePlayerState } from '../player';
import { profileId } from '../profile';
import { ROW_BUTTON } from './TextButton';

/**
 * The book that is loaded, with Play/Pause; opens the Player. Hidden when nothing is loaded.
 * Above the tab bar it leaves the bottom inset to the tab bar.
 */
export function MiniPlayer({ inset = true }: { inset?: boolean }) {
  const state = usePlayerState();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // On a wide screen the whole player is beside the list instead.
  const wide = useWide();
  if (wide || !state.bookId || state.partIndex < 0) return null;
  // Another profile's book stays loaded until this profile plays something; don't show it.
  if (playerProfile() !== profileId) return null;
  const progress = state.durationMs > 0 ? state.positionMs / state.durationMs : 0;

  return (
    <FadeIn lift={16}>
      <Pressable
        onPress={() => router.push('/player')}
        {...ROW_BUTTON}
        accessibilityHint={t('Opens the player')}
        style={{ paddingBottom: (inset ? insets.bottom : 0) + 8 }}
        className="border-t border-line bg-raised"
      >
        <View className="h-0.5 bg-line">
          <View style={{ width: `${Math.min(1, progress) * 100}%` }} className="h-0.5 bg-amber" />
        </View>
        <View className="flex-row items-center gap-3 px-4 pt-2">
          <View className="flex-1">
            <Text numberOfLines={1} className="text-paper">
              {state.bookTitle}
            </Text>
            <Text numberOfLines={1} className="text-sm text-muted">
              {state.partTitle}
            </Text>
          </View>
          <Pressable
            onPress={() => void (state.playing ? audio.pause() : audio.play())}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={state.playing ? t('Pause') : t('Play')}
            className="h-12 w-12 items-center justify-center rounded-full bg-amber"
          >
            <Icon name={state.playing ? 'pause' : 'play'} size={20} color={COLORS.ink} />
          </Pressable>
        </View>
      </Pressable>
    </FadeIn>
  );
}

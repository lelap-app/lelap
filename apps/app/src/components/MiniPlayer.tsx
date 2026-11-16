import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as audio from '../platform/audio';
import { usePlayer } from '../player';

/** The book that is loaded, with Play/Pause; opens the Player. Hidden when nothing is loaded. */
export function MiniPlayer() {
  const { state } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!state.bookId || state.partIndex < 0) return null;
  const progress = state.durationMs > 0 ? state.positionMs / state.durationMs : 0;

  return (
    <Pressable
      onPress={() => router.push('/player')}
      style={{ paddingBottom: insets.bottom + 8 }}
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
          className="h-11 w-11 items-center justify-center rounded-full bg-amber"
        >
          <Text className="text-base text-ink">{state.playing ? '❚❚' : '▶'}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

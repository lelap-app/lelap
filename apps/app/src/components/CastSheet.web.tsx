import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { chooseWebSpeaker, useCasting, useWebCast } from '../casting.web';
import { t } from '../i18n';
import { Sheet } from './Sheet';
import { useColors } from '../theme';

/**
 * Casting in the web app (M125): the browser shows its own list of speakers and TVs (Google Cast
 * in Chrome, AirPlay in Safari), so the sheet has one button that opens it.
 */
export function CastSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  bookId: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const casting = useCasting();
  const cast = useWebCast();
  const playing = cast.state === 'connected';

  return (
    <Sheet visible={visible} title={t('Play on')} onClose={onClose}>
      <View className="gap-3 pb-4">
        <Text className="text-soft">
          {playing
            ? t('This book plays on a speaker or TV. Its controls are in the browser’s list.')
            : t(
                'Your browser lists the speakers and TVs it can reach: Google Cast in Chrome, AirPlay in Safari. Sound effects and skip silence rest while casting.',
              )}
        </Text>
        <View className="flex-row items-center gap-3">
          <Pressable
            // Straight from the tap: browsers only show their list for one.
            onPress={() => void chooseWebSpeaker()}
            accessibilityRole="button"
            className="min-h-12 justify-center rounded-full border border-line px-4 active:bg-night"
          >
            <Text className="text-soft">
              {playing ? t('Change or stop') : t('Choose a speaker or TV')}
            </Text>
          </Pressable>
          {cast.state === 'connecting' && <ActivityIndicator color={colors.amber} />}
        </View>
        {casting.error !== null && (
          <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
            {casting.error}
          </Text>
        )}
      </View>
    </Sheet>
  );
}

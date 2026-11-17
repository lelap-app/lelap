import { playerPaneWidth } from '@lelap/core';
import { usePathname } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';

import { useWide } from '../layout';
import { playerProfile, usePlayerState } from '../player';
import { profileId } from '../profile';
import { PlayerView } from './PlayerView';

/**
 * The player beside the screens on a tablet or a desktop browser, while a book is loaded.
 * It stands aside for the full-screen player and car mode.
 */
export function PlayerPane() {
  const wide = useWide();
  const state = usePlayerState();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  if (!wide || !state.bookId || state.partIndex < 0) return null;
  // Another profile's book stays loaded until this profile plays something; don't show it.
  if (playerProfile() !== profileId) return null;
  if (pathname === '/player' || pathname === '/car') return null;
  return (
    <View style={{ width: playerPaneWidth(width) }} className="border-s border-line bg-night">
      <PlayerView pane />
    </View>
  );
}

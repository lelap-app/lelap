import { usePathname } from 'expo-router';
import { View } from 'react-native';

import { t } from '../i18n';
import { useFold, usePaneWidths, useWide } from '../layout';
import { playerProfile, usePlayerState } from '../player';
import { profileId } from '../profile';
import { Divider } from './Divider';
import { PlayerView } from './PlayerView';

/**
 * The player beside the screens on a tablet or a desktop browser, while a book is loaded; its
 * start edge can be dragged (M113). Around a foldable's hinge it has the half after the hinge,
 * even with nothing loaded, so no screen runs under the hinge. It stands aside for the
 * full-screen player and car mode.
 */
export function PlayerPane() {
  const wide = useWide();
  const fold = useFold();
  const state = usePlayerState();
  const pathname = usePathname();
  const { player: width } = usePaneWidths();
  if (pathname === '/player' || pathname === '/car') return null;
  // Another profile's book stays loaded until this profile plays something; don't show it.
  const loaded = state.bookId !== null && state.partIndex >= 0 && playerProfile() === profileId;
  if (fold.kind === 'tabletop') return null;
  if (fold.kind === 'book') {
    return (
      <View style={{ width }} className="bg-night">
        <PlayerView pane />
      </View>
    );
  }
  if (!wide || !loaded) return null;
  return (
    <>
      <Divider pane="player" width={width} label={t('Player width')} />
      <View style={{ width }} className="bg-night">
        <PlayerView pane />
      </View>
    </>
  );
}

/** The player on the half of a tabletop below the hinge (M113), `height` points tall. */
export function PlayerBelow({ height }: { height: number }) {
  const pathname = usePathname();
  if (pathname === '/player' || pathname === '/car') return null;
  return (
    <View style={{ height }} className="bg-night">
      <PlayerView pane below={height} />
    </View>
  );
}

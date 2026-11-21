import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';

import { StillWhenHidden } from '../player';

/**
 * A navigator's `screenLayout` (M151): a screen out of sight, a tab behind another or a screen
 * under a pushed one, holds still until it is in front again. Neither navigator can freeze
 * screens itself here: Expo Router turns `freezeOnBlur` off.
 */
export function StillScreen({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return <StillWhenHidden hidden={!focused}>{children}</StillWhenHidden>;
}

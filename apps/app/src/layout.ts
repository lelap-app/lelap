import { isWide } from '@lelap/core';
import { Dimensions, useWindowDimensions } from 'react-native';

/** True on tablets and desktop browsers, where the player sits beside the list. */
export function useWide(): boolean {
  const { width, height } = useWindowDimensions();
  return isWide(width, height);
}

/** A page of text and buttons on a wide screen: a readable column in the middle. */
export const READABLE = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

/** The same, read once, for code outside a component. */
export function wideNow(): boolean {
  const { width, height } = Dimensions.get('window');
  return isWide(width, height);
}

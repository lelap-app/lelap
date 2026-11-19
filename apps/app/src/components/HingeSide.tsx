import { type FoldLayout, insetsBeside } from '@lelap/core';
import { type ReactNode, useMemo } from 'react';
import { I18nManager } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * One side of a foldable's hinge (M120): what it draws keeps only the window's insets on its own
 * edges, so the screens above a tabletop's hinge leave no room for the navigation bar.
 */
export function HingeSide({
  fold,
  side,
  children,
}: {
  fold: FoldLayout;
  side: 'first' | 'second';
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => insetsBeside(insets, fold, side, I18nManager.isRTL),
    [insets, fold, side],
  );
  // Always the provider, so a fold never remounts the screens and their history.
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}

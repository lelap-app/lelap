import {
  clampPane,
  type Columns,
  columnsFor,
  type FoldLayout,
  foldLayout,
  getSettings,
  isWide,
  type Pane,
  type PaneChoice,
  paneWidths,
  setSetting,
} from '@lelap/core';
import { useMemo, useSyncExternalStore } from 'react';
import { Dimensions, I18nManager, useWindowDimensions } from 'react-native';

import { db } from './db';
import * as fold from './platform/fold';
import { profileId } from './profile';

/** True on tablets and desktop browsers, where the tabs are a rail and the player sits beside the list. */
export function useWide(): boolean {
  const { width, height } = useWindowDimensions();
  return isWide(width, height);
}

/** A page of text and buttons on a wide screen: a readable column in the middle. */
export const READABLE = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

/** A list of rows on a wide screen: wider than text, but no row stretched across 1920 px (M113). */
export const LIST_COLUMN = { width: '100%', maxWidth: 960, alignSelf: 'center' } as const;

// The hinge, followed from the first screen that asks (M113); the web never has one.
let hinge: fold.Hinge | null = null;
let following = false;
const foldListeners = new Set<() => void>();

function subscribeFold(listener: () => void): () => void {
  if (!following) {
    following = true;
    hinge = fold.current();
    fold.addChangeListener((next) => {
      hinge = next;
      for (const l of foldListeners) l();
    });
    void fold.start().catch(() => {});
  }
  foldListeners.add(listener);
  return () => foldListeners.delete(listener);
}

const readHinge = () => hinge;

/**
 * Where the panes go around a foldable's hinge; `none` on a flat screen and on the web. The hinge
 * brings the window it was measured in, which wins over a window size that hasn't caught up (M120).
 */
export function useFold(): FoldLayout {
  const current = useSyncExternalStore(subscribeFold, readHinge, readHinge);
  const { width, height } = useWindowDimensions();
  return useMemo(() => foldLayout(current, width, height), [current, width, height]);
}

/** Whether the player has a pane of its own: beside the list, or below a tabletop's hinge. */
export function usePlayerBeside(): boolean {
  const wide = useWide();
  const folded = useFold().kind !== 'none';
  return wide || folded;
}

/** The same, read once, for code outside a component. */
export function playerBesideNow(): boolean {
  const { width, height } = Dimensions.get('window');
  return isWide(width, height) || foldLayout(hinge, width, height).kind !== 'none';
}

/** How many columns the window has; a book fold keeps to two, split at its hinge. */
export function useColumns(): Columns {
  const { width, height } = useWindowDimensions();
  const folded = useFold().kind !== 'none';
  const columns = columnsFor(width, height);
  return folded && columns === 3 ? 2 : columns;
}

export function columnsNow(): Columns {
  const { width, height } = Dimensions.get('window');
  const columns = columnsFor(width, height);
  return foldLayout(hinge, width, height).kind !== 'none' && columns === 3 ? 2 : columns;
}

// The widths the dividers were dragged to, read from the profile's settings once and kept here
// while a divider moves, so the panes follow the pointer without writing on every move.
let choice: (PaneChoice & { profile: string }) | null = null;
const paneListeners = new Set<() => void>();

function readChoice(): PaneChoice {
  if (choice?.profile !== profileId) {
    const s = getSettings(db, profileId);
    choice = { profile: profileId, player: s.playerPaneWidth, detail: s.detailPaneWidth };
  }
  return choice;
}

function subscribePanes(listener: () => void): () => void {
  paneListeners.add(listener);
  return () => paneListeners.delete(listener);
}

/** Moves a divider; `save` keeps the width on this device for next time. */
export function setPaneWidth(pane: Pane, width: number | null, save: boolean): void {
  const value = width === null ? null : clampPane(pane, width);
  const before = readChoice();
  choice = {
    profile: profileId,
    player: pane === 'player' ? value : before.player,
    detail: pane === 'detail' ? value : before.detail,
  };
  for (const l of paneListeners) l();
  if (save) {
    setSetting(
      db,
      profileId,
      pane === 'player' ? 'playerPaneWidth' : 'detailPaneWidth',
      value,
      Date.now(),
    );
  }
}

/**
 * The widths of the player's pane and the page's column, for the window and the listener's
 * dividers. Around a book fold the hinge decides instead: the player gets the side after it.
 */
export function usePaneWidths(): { player: number; detail: number } {
  const current = useSyncExternalStore(subscribePanes, readChoice, readChoice);
  const { width } = useWindowDimensions();
  const columns = useColumns();
  const folded = useFold();
  return useMemo(() => {
    if (folded.kind === 'book') {
      // Coordinates are from the left; in a right-to-left layout the player sits on the left.
      return { player: I18nManager.isRTL ? folded.start : folded.width - folded.end, detail: 0 };
    }
    return paneWidths(width, columns, current);
  }, [current, width, columns, folded]);
}

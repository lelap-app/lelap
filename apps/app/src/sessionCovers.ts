import { SessionCovers } from '@lelap/core';
import { useSyncExternalStore } from 'react';

/**
 * The covers Home's rows showed on screen since the app started (M118), so a suggestion tile can
 * show one without fetching anything new. Only in this module: never saved, never synced.
 */
export const sessionCovers = new SessionCovers();

const subscribe = (listener: () => void) => sessionCovers.subscribe(listener);
const size = () => sessionCovers.size;

/** Re-renders when Home's rows have shown a new cover. */
export function useSessionCovers(): SessionCovers {
  useSyncExternalStore(subscribe, size, size);
  return sessionCovers;
}

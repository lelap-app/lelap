import { Platform } from 'react-native';

// Timing of a move between screens (M151), like the start marks (M106): from the tap to the
// first frame after the new screen drew. On the web, `performance.getEntriesByType('measure')`
// in the browser console lists `lelap:nav <screen>`; on Android each one is written to logcat as
// `Lelap nav: <screen> <ms> ms`, for `adb logcat -s ReactNativeJS`. Nothing is kept or sent.

type Timing = {
  mark?: (name: string) => unknown;
  measure?: (name: string, start: string, end: string) => unknown;
  now?: () => number;
};

const perf = () => globalThis.performance as Timing | undefined;
const now = () => perf()?.now?.() ?? Date.now();

// The move under way: the screen it goes to and when the tap came.
let pending: { screen: string; at: number } | null = null;

/** Marks a tap that opens `screen`, as its navigator names it: `library`, `settings/index`. */
export function startNav(screen: string): void {
  try {
    pending = { screen, at: now() };
    perf()?.mark?.(`lelap:nav-start ${screen}`);
  } catch {
    // Timing must never stop a tap.
  }
}

/**
 * Ends the move to `screen` on the frame after it drew; a no-op without one under way. The
 * navigators call it on `focus`, which comes after the commit that drew the screen.
 */
export function endNav(screen: string): void {
  if (pending?.screen !== screen) return;
  const { at } = pending;
  pending = null;
  requestAnimationFrame(() => {
    try {
      const ms = Math.round(now() - at);
      perf()?.mark?.(`lelap:nav-end ${screen}`);
      perf()?.measure?.(
        `lelap:nav ${screen}`,
        `lelap:nav-start ${screen}`,
        `lelap:nav-end ${screen}`,
      );
      if (Platform.OS === 'android') console.info(`Lelap nav: ${screen} ${ms} ms`);
    } catch {
      // As above.
    }
  });
}

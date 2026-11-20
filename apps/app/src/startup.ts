import { Platform } from 'react-native';

// Marks on the way to the first draw (M106), read on the web with
// `performance.getEntriesByType('mark')` in the browser console. On Android (M126) the steps up
// to the first screen are written to logcat as one line, `Lelap start: …`, for
// `adb logcat -s ReactNativeJS`. Nothing is kept or sent.

type Marks = { mark?: (name: string) => unknown };

// When this file first ran, which is early in the bundle: `app/_layout.tsx` imports it.
const loaded = Date.now();
const steps: string[] = [];
let told = false;

/** Marks a step of the start, such as `lelap:db-ready`; a no-op where there is no Performance API. */
export function startupMark(step: string): void {
  try {
    (globalThis.performance as Marks | undefined)?.mark?.(`lelap:${step}`);
    if (Platform.OS !== 'android' || told) return;
    steps.push(`${step} ${Date.now() - loaded} ms`);
    // The first screen is drawn: Home, or the Library when the app opens there.
    if (step === 'home-drawn' || step === 'library-rows') {
      told = true;
      console.info(`Lelap start: ${steps.join(', ')}`);
    }
  } catch {
    // A mark must never stop the start.
  }
}

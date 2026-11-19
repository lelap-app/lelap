// Marks on the way to the first draw (M106), read on the web with
// `performance.getEntriesByType('mark')` in the browser console. Nothing is kept or sent.

type Marks = { mark?: (name: string) => unknown };

/** Marks a step of the start, such as `lelap:db-ready`; a no-op where there is no Performance API. */
export function startupMark(step: string): void {
  try {
    (globalThis.performance as Marks | undefined)?.mark?.(`lelap:${step}`);
  } catch {
    // A mark must never stop the start.
  }
}

// Pure helpers for precise seeking (M39): reading a typed time, slowing the scrubber down, and
// snapping to marks such as bookmarks and chapter starts.

/**
 * A typed time as milliseconds: `2:14:30`, `14:30`, `90` (minutes) or `1h 5m`. Null when it
 * isn't one.
 */
export function parseTime(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === '') return null;
  const units = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/.exec(t);
  if (units && (units[1] || units[2] || units[3])) {
    const [h, m, s] = [units[1], units[2], units[3]].map((v) => Number(v ?? 0));
    return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000;
  }
  if (/^\d+$/.test(t)) return Number(t) * 60_000;
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  const [h, m, s] = nums.length === 3 ? nums : [0, ...nums];
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1000;
}

/**
 * How fast the playhead follows the finger: full speed on the bar, then half, a quarter and a
 * tenth the further the finger moves up (or down) from it, in points.
 */
export function scrubRate(distanceFromBar: number): number {
  const d = Math.abs(distanceFromBar);
  if (d < 48) return 1;
  if (d < 110) return 0.5;
  if (d < 170) return 0.25;
  return 0.1;
}

export const SCRUB_RATE_LABELS: Record<number, string> = {
  1: 'Full speed',
  0.5: 'Half speed',
  0.25: 'Quarter speed',
  0.1: 'Fine',
};

/**
 * The mark within `tolerance` of `offset` (all in ms), or null. With several, the closest.
 */
export function snapTo(offset: number, marks: number[], tolerance: number): number | null {
  let best: number | null = null;
  for (const mark of marks) {
    const d = Math.abs(mark - offset);
    if (d <= tolerance && (best === null || d < Math.abs(best - offset))) best = mark;
  }
  return best;
}

/** How far either side of the playhead the zoomed scrubber reaches (M80). */
export const ZOOM_SPAN_MS = 5 * 60_000;

/**
 * The part of a range the zoomed scrubber covers: `span` either side of `atMs`, moved inside the
 * range at its ends. Null when the range is no longer than that, so zooming would show nothing new.
 */
export function zoomWindow(
  atMs: number,
  lengthMs: number,
  span = ZOOM_SPAN_MS,
): { startMs: number; endMs: number } | null {
  if (lengthMs <= span * 2) return null;
  const startMs = Math.min(Math.max(0, atMs - span), lengthMs - span * 2);
  return { startMs, endMs: startMs + span * 2 };
}

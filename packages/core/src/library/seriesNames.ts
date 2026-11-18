import { fold } from '@lelap/sdk';

// How series are written and compared (M109); pure, so the add-on client can use it too.

/** A series a book names, such as Dune with position `1`; the position is a label, like `2.5`. */
export type SeriesRef = { name: string; position: string | null };

/**
 * The series a tag or server names, as Audiobookshelf writes them: `Dune #1, Dune Chronicles #1`.
 * A name without `#` has no position.
 */
export function parseSeries(text: string | null | undefined): SeriesRef[] {
  const trimmed = text?.trim();
  if (!trimmed) return [];
  if (!trimmed.includes('#')) return [{ name: trimmed, position: null }];
  const refs: SeriesRef[] = [];
  let pending: string[] = [];
  // A comma may sit inside a name (“Rivers of London, The”); a part only ends at its number.
  for (const part of trimmed.split(/\s*,\s*/)) {
    pending.push(part);
    const match = /^(.*?)\s*#\s*(.+)$/.exec(pending.join(', '));
    if (!match) continue;
    const name = match[1]?.trim() ?? '';
    if (name) refs.push({ name, position: match[2]?.trim() || null });
    pending = [];
  }
  for (const name of pending) if (name) refs.push({ name, position: null });
  return refs;
}

/** The same text back, for storing a work's series with a book: `Dune #1, Dune Chronicles #1`. */
export function formatSeries(
  list: readonly { name: string; position?: string | null | undefined }[] | null | undefined,
): string | null {
  const parts = (list ?? [])
    .map(({ name, position }) => {
      const clean = name.replace(/#/g, '').trim();
      if (!clean) return null;
      const at = position?.replace(/[#,]/g, '').trim();
      return at ? `${clean} #${at}` : clean;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The number a position label starts with: `2.5` for “2.5”, `1` for “1-3”; null for none. */
export function seriesNumber(position: string | null | undefined): number | null {
  const match = /^\s*(\d{1,4}(?:\.\d+)?)/.exec(position ?? '');
  return match?.[1] ? Number(match[1]) : null;
}

/** How series names compare: folded, without a leading article or a trailing “series”. */
export function seriesKey(name: string): string {
  return fold(name)
    .replace(/^(the|a|an) /, '')
    .replace(/ series$/, '')
    .trim();
}

import type { SeriesListVolume } from './protocol';

// The order of a series' books (M127), shared by the Catalog add-on and the app. Pure.

/** The number a position starts with: `2.5` for “2.5”, `1` for “1-3”; null for none. */
export function positionNumber(position: string | null | undefined): number | null {
  const match = /^\s*(\d{1,4}(?:\.\d+)?)/.exec(position ?? '');
  return match?.[1] ? Number(match[1]) : null;
}

type Orderable = Pick<SeriesListVolume, 'position' | 'released' | 'title'>;

/**
 * A series in reading order: by position; a book without one goes after the last numbered book
 * released no later than it; books with neither go last, by title. Release dates compare as
 * text, so `2008` and `2008-03-01` both work.
 */
export function orderSeriesVolumes<T extends Orderable>(volumes: readonly T[]): T[] {
  const numbered = volumes
    .map((volume, index) => ({ volume, index, number: positionNumber(volume.position) }))
    .filter((v): v is { volume: T; index: number; number: number } => v.number !== null)
    .sort(
      (a, b) =>
        a.number - b.number ||
        (a.volume.released ?? '').localeCompare(b.volume.released ?? '') ||
        a.index - b.index,
    );
  const unnumbered = volumes.filter((v) => positionNumber(v.position) === null);
  // How far the numbered books have come by each place: the latest release up to it.
  let latest = '';
  const reached = numbered.map(({ volume }) => {
    if (volume.released && volume.released > latest) latest = volume.released;
    return latest;
  });
  const after = new Map<number, T[]>();
  const last: T[] = [];
  const dated = unnumbered
    .filter((v) => v.released)
    .sort((a, b) => (a.released ?? '').localeCompare(b.released ?? ''));
  for (const volume of dated) {
    const released = volume.released ?? '';
    let at = -1;
    for (let i = 0; i < reached.length; i++) if ((reached[i] ?? '') <= released) at = i;
    const list = after.get(at) ?? [];
    list.push(volume);
    after.set(at, list);
  }
  for (const volume of unnumbered) if (!volume.released) last.push(volume);
  last.sort((a, b) => a.title.localeCompare(b.title));
  const out: T[] = [...(after.get(-1) ?? [])];
  numbered.forEach(({ volume }, i) => out.push(volume, ...(after.get(i) ?? [])));
  return [...out, ...last];
}

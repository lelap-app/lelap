import type { Settings } from '../settings';
import type { FoundStream } from './client';

/** What the listener prefers for streams (M153), per profile. */
export type StreamPreferences = {
  /** Most wanted first, lowercase, such as `['m4b', 'mp3']`. */
  formats: string[];
  /** BCP 47, most wanted first, such as `['en']`. */
  languages: string[];
  /** Show streams that are still preparing. */
  showPreparing: boolean;
};

/** One row on the item page: copies of the same release from one or more add-ons. */
export type StreamRow = {
  /** The copy that plays: a ready one first, then in the add-ons' order. */
  first: FoundStream;
  /** Every copy, in the order they play when one fails. */
  copies: FoundStream[];
};

const primary = (tag: string) => tag.toLowerCase().split('-')[0] ?? '';

/** Where a language stands in the list: an exact tag, else its primary language; -1 if neither. */
function languageRank(language: string | undefined, wanted: string[]): number {
  if (!language) return -1;
  const tag = language.toLowerCase();
  const exact = wanted.findIndex((w) => w.toLowerCase() === tag);
  if (exact >= 0) return exact;
  return wanted.findIndex((w) => primary(w) === primary(tag));
}

const formatRank = (format: string | undefined, wanted: string[]) =>
  format ? wanted.indexOf(format.toLowerCase()) : -1;

/** -1 (unmatched) sorts after every match. */
const rankKey = (rank: number, size: number) => (rank < 0 ? size : rank);

const isPreparing = (f: FoundStream) => f.stream.availability === 'preparing';

/**
 * The item page's streams in the listener's order (M153): a preferred language first, then a
 * preferred format, then the add-ons' own order. Streams without `format` or `language` sort
 * after those that match. Copies with the same `releaseId` become one row. Only preparing
 * streams are hidden, and only with `showPreparing` off.
 */
export function orderStreams(found: FoundStream[], prefs: StreamPreferences): StreamRow[] {
  const shown = prefs.showPreparing ? found : found.filter((f) => !isPreparing(f));
  const groups = new Map<string, FoundStream[]>();
  const order: string[] = [];
  for (const [index, f] of shown.entries()) {
    const key = f.stream.releaseId ? `release:${f.stream.releaseId}` : `own:${index}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else {
      groups.set(key, [f]);
      order.push(key);
    }
  }
  const copyLang = (c: FoundStream) =>
    rankKey(languageRank(c.stream.language, prefs.languages), prefs.languages.length);
  const copyFmt = (c: FoundStream) =>
    rankKey(formatRank(c.stream.format, prefs.formats), prefs.formats.length);
  const rows = order.map((key, index) => {
    const copies = groups.get(key) ?? [];
    // Ready before preparing, then the listener's language and format (an MP3 and an M4B of one
    // release), then the add-ons' order, which `copies` already has: sort is stable.
    const sorted = [...copies].sort(
      (a, b) =>
        Number(isPreparing(a)) - Number(isPreparing(b)) ||
        copyLang(a) - copyLang(b) ||
        copyFmt(a) - copyFmt(b),
    );
    return { index, row: { first: sorted[0] as FoundStream, copies: sorted } };
  });
  // A row ranks as the copy that plays: the M4B of a release that also comes as MP3, unless that
  // M4B is still preparing and a ready MP3 plays first.
  const lang = (row: StreamRow) => copyLang(row.first);
  const fmt = (row: StreamRow) => copyFmt(row.first);
  return rows
    .sort((a, b) => lang(a.row) - lang(b.row) || fmt(a.row) - fmt(b.row) || a.index - b.index)
    .map((r) => r.row);
}

/** The profile's stream preferences; languages default to the profile's own. */
export function streamPreferences(settings: Settings): StreamPreferences {
  return {
    formats: settings.streamFormats,
    languages: settings.streamLanguages ?? [settings.language],
    showPreparing: settings.showPreparingStreams,
  };
}

/**
 * The words of a list setting, such as `M4B, mp3` → `['m4b', 'mp3']`: lowercase, without
 * repeats or anything that isn't a format or language code.
 */
export function parseCodeList(text: string, kind: 'format' | 'language'): string[] {
  const valid = kind === 'format' ? /^[a-z0-9]{1,20}$/ : /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
  const seen = new Set<string>();
  for (const word of text.toLowerCase().split(/[\s,;]+/)) {
    if (valid.test(word)) seen.add(word);
  }
  return [...seen].slice(0, kind === 'format' ? 20 : 10);
}

/** A copy's key: its add-on and its `sourceKey`. */
export const copyKey = (f: FoundStream) => `${f.addon.url} ${f.stream.sourceKey}`;

/**
 * The copy to play when the ones in [tried] failed (M155): the row's next one in its order,
 * skipping copies still preparing, which would only make the listener wait. Null when none is
 * left.
 */
export function nextCopy<T extends FoundStream>(copies: T[], tried: string[]): T | null {
  return copies.find((c) => !tried.includes(copyKey(c)) && !isPreparing(c)) ?? null;
}

/** A book started from a row of copies, while the player hasn't opened its audio yet (M155). */
export type CopyFallback = {
  bookId: string;
  /** Keys of the copies played so far, the one playing now last. */
  tried: string[];
  /**
   * The player has reported this book without an error since the copy started, so an error now
   * is this copy's and not the last one's, still on its way.
   */
  seen: boolean;
};

/**
 * What the player's state means for the fallback: `next` when the copy failed before it played,
 * `done` once it plays or another book took over, else `wait`; and the fallback to keep. A
 * failure after the copy played keeps the error under the player: the place is in that copy.
 */
export function copyFallbackStep(
  fallback: CopyFallback,
  state: { bookId: string | null; playing: boolean; error: string | null },
): { step: 'next' | 'done' | 'wait'; fallback: CopyFallback } {
  if (state.bookId !== fallback.bookId) return { step: fallback.seen ? 'done' : 'wait', fallback };
  if (state.playing) return { step: 'done', fallback };
  if (state.error === null) return { step: 'wait', fallback: { ...fallback, seen: true } };
  return { step: fallback.seen ? 'next' : 'wait', fallback };
}

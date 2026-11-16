const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** HTML to plain text: line breaks and paragraphs become newlines, tags go, entities decode. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|h[1-6])(\s[^>]*)?>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Milliseconds from a duration in seconds (`808.54`) or clock form (`13:28`, `1:02:03`).
 * Returns undefined for anything else.
 */
export function parseDuration(value: string | number | undefined | null): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(parseFloat(trimmed) * 1000);
  if (!/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(trimmed)) return undefined;
  const seconds = trimmed.split(':').reduce((total, part) => total * 60 + parseFloat(part), 0);
  return Math.round(seconds * 1000);
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Compares file names so `part2` sorts before `part10`. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

/**
 * Plain lowercase words from user input, safe to put in a Lucene query: anything that is not a
 * letter or digit is dropped, and lowercase `and`/`or`/`not` are ordinary words to Lucene.
 */
export function searchWords(input: string, max = 8): string[] {
  const words =
    input
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const useful = words.filter((word) => word.length > 1);
  return (useful.length > 0 ? useful : words).slice(0, max).map((word) => word.slice(0, 40));
}

/** A URL with an http(s) scheme, or undefined. */
export function httpUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function yearOf(value: string | number | undefined | null): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  const match = value?.match(/\b(\d{4})\b/);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** First non-empty string from a value that may be a string or a list of them. */
export function first(value: string | string[] | undefined): string | undefined {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map((item) => item.trim()).find((item) => item.length > 0);
}

/** Case-insensitive de-duplication that keeps the first spelling. */
export function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

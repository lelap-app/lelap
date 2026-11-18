// Which files are which work: the normalising and scoring that Lelap uses for the listener's own
// library, and that a source add-on uses for its files. Pure functions, no requests.

/** Lower case, without accents and punctuation, words separated by one space. */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const ARTICLES = /^(the|a|an|der|die|das|le|la|les|l|el|los|las|il|het|den|det) /;

// Edition notes that say nothing about which work it is.
const NOISE =
  /[([]\s*(un)?abridged(\s+edition)?\s*[)\]]|\b(un)?abridged(\s+edition)?\s*$|[([]\s*(audio ?book|retail|a novel)\s*[)\]]|:\s*a novel\s*$/gi;

// A series number in brackets: “(Dune, #1)”, “[Book 3]”, “(The Expanse 2)”.
const BRACKETED_SERIES =
  /[([]([^()[\]]*?)(?:#\s*|\b(?:book|bk|vol|volume|part|tome|band|bog)\.?\s*)?(\d{1,3})\s*[)\]]/gi;
// The same at the end: “Harry Potter, Book 2”, “Dune - Book 1”, “… #4”.
const TRAILING_SERIES =
  /[\s,;:-]+(?:#\s*|\b(?:book|bk|vol|volume|part|tome|band|bog)\.?\s*)(\d{1,3})\s*$/i;
// A leading number before a separator, as folder names have it: “03 - The Dragon Reborn”, also
// with a word before it: “Book 2 - The Two Towers”.
const LEADING_NUMBER =
  /^\s*(?:(?:#\s*|\b(?:book|bk|vol|volume|part|tome|band|bog)\.?\s*))?(\d{1,3})\s*[-–—._):]\s+/i;

export type TitleKey = {
  /** The whole title, folded, without edition notes, series number or leading article. */
  full: string;
  /** The same without a subtitle (after `:` or `;`). */
  main: string;
  /** The series number the title carried, if any. */
  number: number | null;
};

const withoutArticle = (text: string) => text.replace(ARTICLES, '');

/**
 * How a title compares: case, accents and punctuation folded, edition notes such as
 * “(Unabridged)” and a leading article dropped, and a series number set apart.
 */
export function titleKey(title: string): TitleKey {
  let number: number | null = null;
  const take = (value: string | undefined) => {
    const parsed = value === undefined ? NaN : parseInt(value, 10);
    if (Number.isFinite(parsed) && number === null) number = parsed;
  };
  let text = title.replace(NOISE, ' ');
  text = text.replace(BRACKETED_SERIES, (match: string, _series: string, n: string) => {
    // A bracket that is only a year, “(1965)”, is not a series number.
    if (/^[([]\s*\d{4}\s*[)\]]$/.test(match)) return ' ';
    take(n);
    return ' ';
  });
  text = text.replace(TRAILING_SERIES, (_match: string, n: string) => {
    take(n);
    return '';
  });
  text = text.replace(LEADING_NUMBER, (_match: string, n: string) => {
    take(n);
    return '';
  });
  // Not at “ - ”: folder names use it for “Series - Title”, and the series alone is no title.
  const main = text.split(/[:;]/)[0] ?? text;
  return { full: withoutArticle(fold(text)), main: withoutArticle(fold(main)), number };
}

// Names that say no one in particular wrote it.
const NO_AUTHOR = new Set(['unknown', 'various', 'various authors', 'anonymous', 'n a', 'none']);
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'dr']);
const PARTICLES = new Set(['de', 'van', 'von', 'le', 'la', 'du', 'da', 'di', 'del', 'der', 'ten']);

/**
 * The people in an author field: “Terry Pratchett, Neil Gaiman”, “A & B”, “A; B”. “Le Guin,
 * Ursula K.” stays one name.
 */
export function splitAuthors(text: string | null | undefined): string[] {
  if (!text) return [];
  const parts = text
    // A narrator in the artist tag is not an author.
    .replace(/[,;(]?\s*\b(read|narrated|performed)\s+by\b.*$/i, '')
    .split(/\s*(?:;|&|\/|\band\b|\bog\b|\bund\b|\bet\b|\by\b)\s*/i)
    .flatMap((part) => {
      const commas = part.split(',').map((p) => p.trim());
      if (commas.length === 2 && isLastFirst(commas[0] ?? '', commas[1] ?? '')) return [part];
      return commas;
    })
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !NO_AUTHOR.has(fold(p)));
  return [...new Set(parts)];
}

/** Whether “X, Y” is a surname and given names rather than two people. */
function isLastFirst(last: string, first: string): boolean {
  const lastWords = fold(last).split(' ').filter(Boolean);
  const firstWords = first.split(/\s+/).filter(Boolean);
  if (lastWords.length === 0 || firstWords.length === 0 || firstWords.length > 3) return false;
  if (lastWords.length === 1) return true;
  return PARTICLES.has(lastWords[0] ?? '');
}

export type AuthorKey = { last: string; first: string | null };

/** An author's surname and first given name, from “First Last” or “Last, First”. */
export function authorKey(name: string): AuthorKey | null {
  const comma = name.indexOf(',');
  const ordered =
    comma > 0 && isLastFirst(name.slice(0, comma), name.slice(comma + 1))
      ? `${name.slice(comma + 1)} ${name.slice(0, comma)}`
      : name;
  const words = fold(ordered)
    .split(' ')
    .filter((w) => w.length > 0 && !SUFFIX.has(w));
  const last = words[words.length - 1];
  if (last === undefined || NO_AUTHOR.has(words.join(' '))) return null;
  return { last, first: words.length > 1 ? (words[0] ?? null) : null };
}

/**
 * The same person: the same surname, and given names that start with the same letter when both
 * have them, so “J. R. R. Tolkien” is “Tolkien, John Ronald Reuel” and Stephen King is not Owen
 * King.
 */
export function sameAuthor(a: string, b: string): boolean {
  const left = authorKey(a);
  const right = authorKey(b);
  if (!left || !right || left.last !== right.last) return false;
  if (left.first === null || right.first === null) return true;
  return left.first[0] === right.first[0];
}

/** Whether two lists of authors share a person. An empty list matches nothing. */
export function sameAuthors(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => sameAuthor(x, y)));
}

const isbn10Valid = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = digits[i] ?? '';
    const value = c === 'X' ? 10 : Number(c);
    if (c === 'X' && i !== 9) return false;
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
};

const isbn13Check = (first12: string) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
};

/** An ISBN as 13 digits, from ISBN-10 or ISBN-13 with or without hyphens; null when invalid. */
export function normalizeIsbn(value: string): string | null {
  const digits = value.toUpperCase().replace(/[^0-9X]/g, '');
  if (digits.length === 10 && /^\d{9}[\dX]$/.test(digits) && isbn10Valid(digits)) {
    const first12 = `978${digits.slice(0, 9)}`;
    return first12 + isbn13Check(first12);
  }
  if (/^97[89]\d{10}$/.test(digits) && isbn13Check(digits.slice(0, 12)) === digits[12]) {
    return digits;
  }
  return null;
}

/**
 * One ID in the form the index keys on: `isbn:` as 13 digits, `asin:` and `ol:` in upper case,
 * other prefixes as they are. Null for an ID that can't be right, such as an ISBN with a wrong
 * check digit.
 */
export function normalizeId(id: string): string | null {
  const colon = id.indexOf(':');
  if (colon <= 0) return null;
  const prefix = id.slice(0, colon).trim().toLowerCase();
  const value = id.slice(colon + 1).trim();
  if (!value) return null;
  if (prefix === 'isbn') {
    const isbn = normalizeIsbn(value);
    return isbn ? `isbn:${isbn}` : null;
  }
  if (prefix === 'asin') {
    const asin = value.toUpperCase();
    return /^[A-Z0-9]{10}$/.test(asin) ? `asin:${asin}` : null;
  }
  if (prefix === 'ol') {
    const ol = value.toUpperCase();
    return /^OL\d+[WMA]$/.test(ol) ? `ol:${ol}` : null;
  }
  return /^[a-z][a-z0-9_-]*$/.test(prefix) ? `${prefix}:${value}` : null;
}

/** Valid IDs, normalised, without repeats. */
export function normalizeIds(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const normal = normalizeId(id);
    if (!normal) continue;
    out.add(normal);
    // A print book's ASIN is its ISBN-10, so it also meets the same book's `isbn:978…`.
    if (normal.startsWith('asin:') && /^\d{9}[\dX]$/.test(normal.slice(5))) {
      const isbn = normalizeId(`isbn:${normal.slice(5)}`);
      if (isbn) out.add(isbn);
    }
  }
  return [...out];
}

/**
 * ISBNs and ASINs from file tags, by tag name in any spelling: `ISBN`, `ISBN13`, `ASIN`,
 * `AUDIBLE_ASIN`, iTunes' `----:com.apple.iTunes:ASIN`. A value may hold several, separated by
 * commas, semicolons or slashes.
 */
export function idsFromTags(
  tags: Record<string, string | readonly string[] | null | undefined>,
): string[] {
  const ids: string[] = [];
  for (const [name, raw] of Object.entries(tags)) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const prefix = key.includes('isbn') ? 'isbn' : key.endsWith('asin') ? 'asin' : null;
    if (!prefix || raw == null) continue;
    for (const value of typeof raw === 'string' ? [raw] : raw) {
      for (const part of value.split(/[,;/|]/)) ids.push(`${prefix}:${part}`);
    }
  }
  return normalizeIds(ids);
}

/** What is known about a work, or about the files of one book. */
export type WorkInfo = {
  title?: string | null;
  /** Each person separately; `splitAuthors` splits a tag that names several. */
  authors?: readonly string[];
  /** `isbn:…`, `asin:…`, `ol:…` and the like; normalised on the way in. */
  ids?: readonly string[];
  /** The book's number in its series, when known. */
  series?: number | null;
};

/**
 * How sure a match is. `id`: an ISBN, ASIN or other ID both sides share, safe to link without
 * asking. `title`: the same title and author after normalising, to be confirmed by a person.
 */
export type MatchStrength = 'id' | 'title';

/** Whether a work and a book are the same, and how sure that is; null when they are not. */
export function matchStrength(work: WorkInfo, book: WorkInfo): MatchStrength | null {
  const workIds = new Set(normalizeIds(work.ids ?? []));
  if (normalizeIds(book.ids ?? []).some((id) => workIds.has(id))) return 'id';
  return sameTitle(work, book) ? 'title' : null;
}

/** Same title and author, and no series numbers that disagree. Both sides need an author. */
function sameTitle(work: WorkInfo, book: WorkInfo): boolean {
  if (!work.title || !book.title) return false;
  const a = titleKey(work.title);
  const b = titleKey(book.title);
  // A title that folds to nothing says too little to go on.
  if (a.main.length < 2 || b.main.length < 2) return false;
  // “01” is a track, not a title; “1984” is a title.
  if (/^\d+$/.test(a.full) || /^\d+$/.test(b.full)) {
    if (a.full !== b.full || a.full.length < 3) return false;
  }
  // A subtitle may be left out on one side, never differ: “Mistborn: The Final Empire” is not
  // “Mistborn: The Well of Ascension”.
  const plain = (k: TitleKey) => k.main === k.full;
  const titles =
    a.full === b.full || (plain(b) && a.main === b.full) || (plain(a) && a.full === b.main);
  if (!titles) return false;
  const left = work.series ?? a.number;
  const right = book.series ?? b.number;
  if (left !== null && right !== null && left !== right) return false;
  return sameAuthors(work.authors ?? [], book.authors ?? []);
}

export type WorkMatch<T> = { item: T; strength: MatchStrength };

export type WorkIndex<T> = {
  /** The items that carry this ID. */
  byId(id: string): T[];
  /**
   * The items that are this work: those sharing an ID if there are any, else those with the same
   * title and author. Items whose own IDs name a different edition come last.
   */
  find(work: WorkInfo): WorkMatch<T>[];
};

/**
 * An index from IDs, titles and authors to your items (files, books, rows): build it once from
 * your file list and ask it for each work. Nothing leaves the process.
 */
export function createWorkIndex<T>(entries: Iterable<WorkInfo & { item: T }>): WorkIndex<T> {
  const ids = new Map<string, T[]>();
  const titles = new Map<string, (WorkInfo & { item: T })[]>();
  const add = <V>(map: Map<string, V[]>, key: string, value: V) => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else map.set(key, [value]);
  };
  for (const entry of entries) {
    for (const id of normalizeIds(entry.ids ?? [])) add(ids, id, entry.item);
    if (!entry.title) continue;
    const key = titleKey(entry.title);
    add(titles, key.full, entry);
    add(titles, key.main, entry);
  }

  const byId = (id: string) => {
    const normal = normalizeId(id);
    return normal ? [...(ids.get(normal) ?? [])] : [];
  };

  return {
    byId,
    find(work) {
      const sharing = [...new Set(normalizeIds(work.ids ?? []).flatMap(byId))];
      if (sharing.length > 0) return sharing.map((item) => ({ item, strength: 'id' as const }));
      if (!work.title) return [];
      const key = titleKey(work.title);
      const candidates = new Set([
        ...(titles.get(key.full) ?? []),
        ...(titles.get(key.main) ?? []),
      ]);
      const wanted = new Set(normalizeIds(work.ids ?? []).map((id) => id.split(':')[0]));
      // An item with its own ISBN where the work has another is likely a different edition.
      const otherEdition = (entry: WorkInfo) =>
        normalizeIds(entry.ids ?? []).some((id) => wanted.has(id.split(':')[0]));
      return [...candidates]
        .filter((entry) => sameTitle(work, entry))
        .sort((a, b) => Number(otherEdition(a)) - Number(otherEdition(b)))
        .map((entry) => ({ item: entry.item, strength: 'title' as const }));
    },
  };
}

import type { KindTags } from '../schema';

// Which library items look like music rather than books (M77). Only ever a suggestion: the
// listener decides what is hidden. Every number the decision uses is in MUSIC_RULES.

export const MUSIC_RULES = {
  /** A single file shorter than this, with no chapters, is song-length. */
  maxSongMs: 8 * 60_000,
  weights: {
    songLength: 2,
    isrcTag: 3,
    isrcInTitle: 2,
    musicGenre: 2,
    musicTags: 2,
    flac: 1,
    /** A genre such as “Audiobook” or “Spoken Word”: outweighs everything else. */
    spokenGenre: -10,
  },
  /** The score an item needs to be suggested… */
  minScore: 4,
  /** …from at least this many signals, so no single one is enough. */
  minSignals: 2,
} as const;

export type MusicSignal = Exclude<keyof typeof MUSIC_RULES.weights, 'spokenGenre'>;

/** What the library knows about an item; a server or the web may know only some of it. */
export type MusicEvidence = {
  /** Audio files the item is made of. */
  fileCount: number;
  durationMs: number;
  chapterCount: number;
  /** The first file's name, such as `Example Song.flac`. */
  fileName: string;
  title: string;
  album: string | null;
  /** Null for files read before M77, on the web and from servers that give no such tags. */
  tags: KindTags | null;
  /** The item came from a podcast, an add-on stream or a source that only holds audiobooks. */
  bookSource: boolean;
};

export type MusicScore = { suggest: boolean; score: number; signals: MusicSignal[] };

/** Two letters, three letters or digits, then seven digits: `XX0AB2400001`. */
const ISRC = /\b[A-Z]{2}[A-Z0-9]{3}\d{7}\b/;
const ISRC_DASHED = /\b[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}\b/;

const SPOKEN = [
  'audiobook',
  'audio book',
  'audiobooks',
  'speech',
  'spoken word',
  'spoken',
  'podcast',
  'hörbuch',
  'hoerbuch',
  'lydbog',
  'luisterboek',
  'livre audio',
];

// Words that only name music genres; “drama” or “comedy” could be either and are left out.
const MUSIC_GENRES = [
  'rock',
  'pop',
  'jazz',
  'blues',
  'classical',
  'metal',
  'punk',
  'hip hop',
  'hip-hop',
  'rap',
  'r&b',
  'rnb',
  'soul',
  'funk',
  'disco',
  'electronic',
  'electronica',
  'techno',
  'house',
  'trance',
  'dubstep',
  'drum and bass',
  'edm',
  'dance',
  'reggae',
  'ska',
  'country',
  'folk',
  'indie',
  'alternative',
  'grunge',
  'ambient',
  'soundtrack',
  'latin',
  'salsa',
  'k-pop',
  'j-pop',
  'gospel',
  'opera',
  'singer-songwriter',
  'new wave',
  'synthpop',
  'lo-fi',
  'chillout',
  'world music',
  'instrumental',
];

const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}&+-]+/gu, ' ')} `;

export function isSpokenGenre(genre: string): boolean {
  const text = words(genre);
  return SPOKEN.some((g) => text.includes(` ${g} `));
}

export function isMusicGenre(genre: string): boolean {
  if (isSpokenGenre(genre)) return false;
  // ID3v1 genres arrive as `(17)` or `17` when the reader doesn't map them; all of 0–79 are music.
  const number = /^\(?(\d{1,3})\)?$/.exec(genre.trim());
  if (number) return Number(number[1]) < 80;
  const text = words(genre);
  return MUSIC_GENRES.some((g) => text.includes(` ${g} `));
}

/** An ISRC-shaped code in a title or file name, such as `[XX0AB2400001]`. */
export function hasIsrcCode(text: string): boolean {
  return ISRC.test(text) || ISRC_DASHED.test(text);
}

const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

const present = (value: string | null | undefined) =>
  value !== null && value !== undefined && value.trim() !== '';

/** Whether the item is one an audiobook player should never suggest hiding. */
export function isSurelyBook(item: MusicEvidence): boolean {
  return (
    item.bookSource ||
    item.fileCount !== 1 ||
    item.chapterCount > 0 ||
    extension(item.fileName) === 'm4b' ||
    item.tags?.mediaKind === 'audiobook' ||
    item.tags?.mediaKind === 'podcast'
  );
}

/** Scores one item; pure, so the same evidence always gives the same answer. */
export function musicScore(item: MusicEvidence): MusicScore {
  if (isSurelyBook(item)) return { suggest: false, score: 0, signals: [] };
  const { weights } = MUSIC_RULES;
  const tags = item.tags;
  const signals: MusicSignal[] = [];
  let score = 0;
  const add = (signal: MusicSignal) => {
    signals.push(signal);
    score += weights[signal];
  };

  if (item.durationMs > 0 && item.durationMs < MUSIC_RULES.maxSongMs) add('songLength');
  if (present(tags?.isrc)) add('isrcTag');
  else if (hasIsrcCode(item.title) || hasIsrcCode(item.fileName)) add('isrcInTitle');
  if (tags?.genre) {
    if (isSpokenGenre(tags.genre)) score += weights.spokenGenre;
    else if (isMusicGenre(tags.genre)) add('musicGenre');
  }
  const albumTagged = present(item.album);
  if (tags && albumTagged && present(tags.track) && present(tags.year) && !present(tags.narrator)) {
    add('musicTags');
  }
  if (extension(item.fileName) === 'flac') add('flac');

  const suggest = score >= MUSIC_RULES.minScore && signals.length >= MUSIC_RULES.minSignals;
  return { suggest, score, signals };
}

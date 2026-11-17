import type { StoredChapter } from '../schema';
import { asArray, htmlToText, isNode, textOf, type XmlNode } from './xml';

/** `podcast:person`: who hosts, guests or produces a show or an episode. */
export type FeedPerson = {
  name: string;
  /** Lower case, as the namespace's taxonomy writes it; `host` when the feed says nothing. */
  role: string;
  group: string;
  img: string | null;
  href: string | null;
};

/** `podcast:funding`: where listeners can support the show. */
export type FeedFunding = { url: string; label: string | null };

/** `podcast:transcript`: one file per format and language. */
export type FeedTranscript = {
  url: string;
  type: string;
  language: string | null;
  /** `captions` marks a file timed for closed captions. */
  rel: string | null;
};

/** Podcasting 2.0 fields of a show, kept as one JSON value. */
export type PodcastExtras = { persons: FeedPerson[]; funding: FeedFunding[] };

/** Podcasting 2.0 fields of an episode, kept as one JSON value. */
export type EpisodeExtras = {
  chaptersUrl: string | null;
  transcripts: FeedTranscript[];
  persons: FeedPerson[];
  /** `podcast:season name=…`: a title for the season, such as “Race for the White House”. */
  seasonName: string | null;
};

const isHttp = (url: string) => /^https?:\/\//i.test(url);
const httpOrNull = (url: string) => (isHttp(url) ? url : null);
const orNull = (text: string) => (text === '' ? null : text);
const attr = (node: XmlNode, name: string) => textOf(node[`@_${name}`]);
const nodes = (parent: XmlNode, tag: string): XmlNode[] =>
  asArray(parent[tag]).map((value) => (isNode(value) ? value : { '#text': value }));

export function personsOf(parent: XmlNode): FeedPerson[] {
  return nodes(parent, 'podcast:person')
    .map((node) => ({
      name: htmlToText(textOf(node)),
      role: attr(node, 'role').toLowerCase() || 'host',
      group: attr(node, 'group').toLowerCase() || 'cast',
      img: httpOrNull(attr(node, 'img')),
      href: httpOrNull(attr(node, 'href')),
    }))
    .filter((p) => p.name !== '');
}

export function fundingOf(channel: XmlNode): FeedFunding[] {
  return nodes(channel, 'podcast:funding')
    .map((node) => ({ url: attr(node, 'url'), label: orNull(htmlToText(textOf(node))) }))
    .filter((f) => isHttp(f.url));
}

export function podcastExtrasOf(channel: XmlNode): PodcastExtras {
  return { persons: personsOf(channel), funding: fundingOf(channel) };
}

export function episodeExtrasOf(item: XmlNode): EpisodeExtras {
  const chapters = nodes(item, 'podcast:chapters').find((n) => isHttp(attr(n, 'url')));
  const season = nodes(item, 'podcast:season')[0];
  return {
    chaptersUrl: chapters ? attr(chapters, 'url') : null,
    transcripts: nodes(item, 'podcast:transcript')
      .map((node) => ({
        url: attr(node, 'url'),
        type: attr(node, 'type').toLowerCase(),
        language: orNull(attr(node, 'language')),
        rel: orNull(attr(node, 'rel')),
      }))
      .filter((t) => isHttp(t.url)),
    persons: personsOf(item),
    seasonName: season ? orNull(htmlToText(attr(season, 'name'))) : null,
  };
}

// Timed formats first: they can follow along with the position.
const TRANSCRIPT_RANK: [RegExp, number][] = [
  [/json/, 0],
  [/vtt/, 1],
  [/srt|subrip/, 2],
  [/html/, 3],
  [/text\/plain/, 4],
];
const rankOf = (type: string) => TRANSCRIPT_RANK.find(([re]) => re.test(type))?.[1];

/** The transcript to show: a timed format before plain text, the feed's order otherwise. */
export function pickTranscript(transcripts: FeedTranscript[]): FeedTranscript | null {
  let best: FeedTranscript | null = null;
  let bestRank = Infinity;
  for (const t of transcripts) {
    const rank = rankOf(t.type);
    if (rank !== undefined && rank < bestRank) {
      best = t;
      bestRank = rank;
    }
  }
  return best;
}

const seconds = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * A JSON chapters file (`application/json+chapters`). Entries with `toc: false` only change the
 * artwork mid-chapter, so they are left out; the rest are sorted by start.
 */
export function parseChaptersFile(text: string): StoredChapter[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = isNode(data) && Array.isArray(data.chapters) ? data.chapters : [];
  const chapters: StoredChapter[] = [];
  for (const entry of list) {
    if (!isNode(entry) || entry.toc === false) continue;
    const start = seconds(entry.startTime);
    if (start === null) continue;
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    chapters.push({
      title: title || `Chapter ${chapters.length + 1}`,
      startMs: Math.round(start * 1000),
    });
  }
  chapters.sort((a, b) => a.startMs - b.startMs);
  return chapters.filter((c, i) => i === 0 || c.startMs !== chapters[i - 1]?.startMs);
}

/** One line of a transcript. Untimed transcripts (HTML, plain text) have `startMs` null. */
export type TranscriptCue = {
  startMs: number | null;
  endMs: number | null;
  speaker: string | null;
  text: string;
};

/** `00:01:02,500`, `01:02.5`, `62.5` as milliseconds. */
function clockMs(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return Math.round(parts.reduce((total, p) => total * 60 + Number(p), 0) * 1000);
}

const TIMING = /^\s*(\S+)\s+-->\s+(\S+)/;

/** SRT and WebVTT: blocks of an optional number, a timing line and text. */
function parseTimedText(text: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at < 0) continue;
    const match = TIMING.exec(lines[at] ?? '');
    const start = clockMs(match?.[1] ?? '');
    if (start === null) continue;
    let speaker: string | null = null;
    const body = lines
      .slice(at + 1)
      .join(' ')
      // WebVTT voice tags: `<v Alice>Hello`.
      .replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>/g, (_, name: string) => {
        speaker ??= name.trim();
        return '';
      })
      .replace(/<[^>]*>/g, '');
    let line = htmlToText(body);
    // SRT has no speaker field; many files write `Alice: Hello`.
    const named = /^([A-Z][\w .'-]{0,40}):\s+(.+)$/.exec(line);
    if (!speaker && named) {
      speaker = named[1] ?? null;
      line = named[2] ?? line;
    }
    if (line === '') continue;
    cues.push({ startMs: start, endMs: clockMs(match?.[2] ?? ''), speaker, text: line });
  }
  return cues;
}

// Word-level JSON transcripts are joined into sentences, so each line is worth tapping.
const MAX_CUE_CHARS = 200;

function parseJsonTranscript(text: string): TranscriptCue[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const segments = isNode(data) && Array.isArray(data.segments) ? data.segments : [];
  const cues: TranscriptCue[] = [];
  let open: TranscriptCue | null = null;
  let lastSpeaker: string | null = null;
  for (const segment of segments) {
    if (!isNode(segment) || typeof segment.body !== 'string') continue;
    const start = seconds(segment.startTime);
    if (start === null) continue;
    const end = seconds(segment.endTime);
    const body = segment.body.trim();
    if (body === '') continue;
    const speaker = typeof segment.speaker === 'string' ? segment.speaker.trim() || null : null;
    const joins =
      open !== null &&
      (speaker === null || speaker === open.speaker) &&
      !/[.?!]["”’)]?$/.test(open.text) &&
      open.text.length + body.length < MAX_CUE_CHARS;
    if (open && joins) {
      open.text = /^[,.;:!?)]/.test(body) ? open.text + body : `${open.text} ${body}`;
      open.endMs = end === null ? open.endMs : Math.round(end * 1000);
    } else {
      open = {
        startMs: Math.round(start * 1000),
        endMs: end === null ? null : Math.round(end * 1000),
        speaker: speaker ?? lastSpeaker,
        text: body,
      };
      cues.push(open);
    }
    lastSpeaker = open.speaker;
  }
  return cues;
}

function parseUntimed(text: string, html: boolean): TranscriptCue[] {
  const plain = html ? htmlToText(text) : text.replace(/\r\n?/g, '\n');
  return plain
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => ({ startMs: null, endMs: null, speaker: null, text: p }));
}

/** Reads a transcript of the given MIME type into lines. Unknown types give no lines. */
export function parseTranscript(text: string, type: string): TranscriptCue[] {
  const kind = type.toLowerCase();
  if (kind.includes('json')) return parseJsonTranscript(text);
  if (/vtt|srt|subrip/.test(kind)) return parseTimedText(text);
  if (kind.includes('html')) return parseUntimed(text, true);
  if (kind.startsWith('text/')) return parseUntimed(text, false);
  return [];
}

/** The line playing at a position: the last one that started at or before it, or -1. */
export function cueAt(cues: TranscriptCue[], positionMs: number): number {
  let found = -1;
  for (let i = 0; i < cues.length; i++) {
    const start = cues[i]?.startMs;
    if (start === null || start === undefined) continue;
    if (start > positionMs) break;
    found = i;
  }
  return found;
}

export type SeasonGroup<T> = { season: number | null; name: string | null; episodes: T[] };

/**
 * Episodes by season, newest season first, keeping each season's order. A feed with fewer than
 * two seasons gives one group with `season` null; episodes without a season come last.
 */
export function groupBySeason<T extends { season: number | null; extras: EpisodeExtras | null }>(
  list: T[],
): SeasonGroup<T>[] {
  const seasons = new Set(list.map((e) => e.season).filter((s) => s !== null));
  if (seasons.size < 2) return [{ season: null, name: null, episodes: list }];
  const groups = new Map<number | null, SeasonGroup<T>>();
  for (const e of list) {
    let group = groups.get(e.season);
    if (!group) {
      group = { season: e.season, name: null, episodes: [] };
      groups.set(e.season, group);
    }
    group.name ??= e.extras?.seasonName ?? null;
    group.episodes.push(e);
  }
  return [...groups.values()].sort((a, b) => (b.season ?? -1) - (a.season ?? -1));
}

/** People in the order hosts, guests, then everyone else; the same name only once. */
export function castOf(persons: FeedPerson[]): FeedPerson[] {
  const rank = (role: string) => (role === 'host' ? 0 : role === 'guest' ? 1 : 2);
  const seen = new Set<string>();
  return [...persons]
    .sort((a, b) => rank(a.role) - rank(b.role))
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

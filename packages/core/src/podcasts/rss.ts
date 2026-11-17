import {
  episodeExtrasOf,
  type EpisodeExtras,
  podcastExtrasOf,
  type PodcastExtras,
} from './podcasting';
import {
  asArray,
  attrOf,
  FeedError,
  htmlToText,
  isNode,
  parseXml,
  textOf,
  type XmlNode,
} from './xml';

export type FeedEpisode = {
  guid: string;
  title: string;
  description: string | null;
  publishedAt: number | null;
  season: number | null;
  number: number | null;
  durationMs: number;
  url: string;
  mime: string | null;
  size: number;
  extras: EpisodeExtras;
};

export type ParsedFeed = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string | null;
  link: string | null;
  guid: string | null;
  extras: PodcastExtras;
  episodes: FeedEpisode[];
};

const isHttp = (url: string) => /^https?:\/\//i.test(url);
const orNull = (text: string) => (text === '' ? null : text);

function positiveInt(text: string): number | null {
  if (text === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** `itunes:duration` as seconds (`1830`, `1830.5`) or a clock (`30:30`, `1:02:03`). */
export function parseDuration(text: string): number {
  const value = text.trim();
  if (value === '') return 0;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const parts = value.split(':').map(Number);
  if (parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return 0;
  return Math.round(parts.reduce((total, p) => total * 60 + p, 0) * 1000);
}

function enclosureOf(item: Record<string, unknown>) {
  const enclosures = asArray(item.enclosure).filter(isNode);
  const audio =
    enclosures.find((e) => textOf(e['@_type']).startsWith('audio/')) ??
    enclosures.find((e) => isHttp(textOf(e['@_url'])));
  if (!audio) return null;
  const url = textOf(audio['@_url']);
  if (!isHttp(url)) return null;
  const size = Number(textOf(audio['@_length']));
  return {
    url,
    mime: orNull(textOf(audio['@_type'])),
    size: Number.isFinite(size) && size > 0 ? size : 0,
  };
}

/** Reads an RSS 2.0 or Atom podcast feed. Items without an audio enclosure are left out. */
export function parseFeed(xml: string): ParsedFeed {
  const doc = parseXml(xml);
  const atom = asArray(doc.feed).find(isNode);
  if (atom) return parseAtom(atom);
  const rss = doc.rss;
  const channel = isNode(rss) ? asArray(rss.channel).find(isNode) : undefined;
  if (!channel) throw new FeedError('This is not an RSS or Atom feed.');
  const title = htmlToText(textOf(channel.title));
  if (title === '') throw new FeedError('The feed has no title.');

  const episodes: FeedEpisode[] = [];
  const seen = new Set<string>();
  for (const item of asArray(channel.item).filter(isNode)) {
    const enclosure = enclosureOf(item);
    if (!enclosure) continue;
    const guid = textOf(item.guid) || enclosure.url;
    if (seen.has(guid)) continue;
    seen.add(guid);
    const published = Date.parse(textOf(item.pubDate));
    const description = htmlToText(
      textOf(item['content:encoded']) || textOf(item.description) || textOf(item['itunes:summary']),
    );
    episodes.push({
      guid,
      title:
        htmlToText(textOf(item.title)) ||
        htmlToText(textOf(item['itunes:title'])) ||
        'Untitled episode',
      description: orNull(description),
      publishedAt: Number.isFinite(published) ? published : null,
      season:
        positiveInt(textOf(item['itunes:season'])) ?? positiveInt(textOf(item['podcast:season'])),
      number:
        positiveInt(textOf(item['itunes:episode'])) ?? positiveInt(textOf(item['podcast:episode'])),
      durationMs: parseDuration(textOf(item['itunes:duration'])),
      ...enclosure,
      extras: episodeExtrasOf(item),
    });
  }

  const image = asArray(channel.image).find(isNode);
  const cover = attrOf(channel['itunes:image'], 'href') || (image ? textOf(image.url) : '');
  const link = asArray(channel.link).map(textOf).find(isHttp) ?? '';
  return {
    title,
    author: orNull(htmlToText(textOf(channel['itunes:author']) || textOf(channel.managingEditor))),
    description: orNull(
      htmlToText(textOf(channel.description) || textOf(channel['itunes:summary'])),
    ),
    coverUrl: isHttp(cover) ? cover : null,
    link: orNull(link),
    guid: orNull(textOf(channel['podcast:guid'])),
    extras: podcastExtrasOf(channel),
    episodes,
  };
}

/** Atom `<link>`s with this `rel`; a link without one is `alternate`. */
const atomLinks = (node: XmlNode, rel: string): XmlNode[] =>
  asArray(node.link)
    .filter(isNode)
    .filter((l) => (textOf(l['@_rel']) || 'alternate') === rel);

function atomEnclosureOf(entry: XmlNode) {
  const links = atomLinks(entry, 'enclosure');
  const audio =
    links.find((l) => textOf(l['@_type']).startsWith('audio/')) ??
    links.find((l) => isHttp(textOf(l['@_href'])) && textOf(l['@_type']) === '');
  if (!audio) return null;
  const url = textOf(audio['@_href']);
  if (!isHttp(url)) return null;
  const size = Number(textOf(audio['@_length']));
  return {
    url,
    mime: orNull(textOf(audio['@_type'])),
    size: Number.isFinite(size) && size > 0 ? size : 0,
  };
}

const atomAuthor = (author: unknown): string => {
  const first = asArray(author).find(isNode);
  return first ? htmlToText(textOf(first.name)) : '';
};

/**
 * Atom (RFC 4287): `<entry>`s with a `<link rel="enclosure">`. iTunes and Podcasting 2.0 tags
 * are read as in RSS.
 */
function parseAtom(feed: XmlNode): ParsedFeed {
  const title = htmlToText(textOf(feed.title));
  if (title === '') throw new FeedError('The feed has no title.');

  const episodes: FeedEpisode[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(feed.entry).filter(isNode)) {
    const enclosure = atomEnclosureOf(entry);
    if (!enclosure) continue;
    const guid = textOf(entry.id) || enclosure.url;
    if (seen.has(guid)) continue;
    seen.add(guid);
    const published = Date.parse(textOf(entry.published) || textOf(entry.updated));
    const description = htmlToText(
      textOf(entry.content) || textOf(entry.summary) || textOf(entry['itunes:summary']),
    );
    episodes.push({
      guid,
      title:
        htmlToText(textOf(entry.title)) ||
        htmlToText(textOf(entry['itunes:title'])) ||
        'Untitled episode',
      description: orNull(description),
      publishedAt: Number.isFinite(published) ? published : null,
      season:
        positiveInt(textOf(entry['itunes:season'])) ?? positiveInt(textOf(entry['podcast:season'])),
      number:
        positiveInt(textOf(entry['itunes:episode'])) ??
        positiveInt(textOf(entry['podcast:episode'])),
      durationMs: parseDuration(textOf(entry['itunes:duration'])),
      ...enclosure,
      extras: episodeExtrasOf(entry),
    });
  }

  const cover = attrOf(feed['itunes:image'], 'href') || textOf(feed.logo) || textOf(feed.icon);
  const link = atomLinks(feed, 'alternate')
    .map((l) => textOf(l['@_href']))
    .find(isHttp);
  return {
    title,
    author: orNull(htmlToText(textOf(feed['itunes:author'])) || atomAuthor(feed.author)),
    description: orNull(htmlToText(textOf(feed.subtitle) || textOf(feed['itunes:summary']))),
    coverUrl: isHttp(cover) ? cover : null,
    link: link ?? null,
    guid: orNull(textOf(feed['podcast:guid'])),
    extras: podcastExtrasOf(feed),
    episodes,
  };
}

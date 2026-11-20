import type { XMLParser } from 'fast-xml-parser';

// Entities stay off: RSS text is decoded below, and no feed gets to define its own.
const OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Atom text constructs stay raw, so `type="xhtml"` keeps its markup in order (M75).
  stopNodes: ['feed.subtitle', 'feed.entry.content', 'feed.entry.summary'],
};

// Loaded with the first feed or listing read, so the web app's start bundle leaves the parser
// (about 90 KB) out (M126).
let parser: Promise<XMLParser> | null = null;

export type XmlNode = Record<string, unknown>;

export class FeedError extends Error {}

export async function parseXml(xml: string): Promise<XmlNode> {
  parser ??= import('fast-xml-parser').then(({ XMLParser }) => new XMLParser(OPTIONS));
  const loaded = await parser;
  try {
    return loaded.parse(xml) as XmlNode;
  } catch (error) {
    throw new FeedError(
      `Not readable XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const isNode = (value: unknown): value is XmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** The text of an element, whether it came as a string, a number or a node with attributes. */
export function textOf(value: unknown): string {
  const first = asArray(value)[0];
  if (typeof first === 'string' || typeof first === 'number')
    return decodeEntities(String(first)).trim();
  if (isNode(first) && '#text' in first) return textOf(first['#text']);
  return '';
}

export const attrOf = (value: unknown, name: string): string => {
  const first = asArray(value)[0];
  return isNode(first) ? textOf(first[`@_${name}`]) : '';
};

/**
 * An Atom text construct as plain text. `type="xhtml"` holds markup, not escaped HTML: its
 * entities are decoded only after the tags are gone, so a written `&lt;b&gt;` stays text.
 */
export function atomTextOf(value: unknown): string {
  const first = asArray(value)[0];
  if (isNode(first) && textOf(first['@_type']).toLowerCase() === 'xhtml') {
    const raw = asArray(first['#text'])[0];
    return typeof raw === 'string' ? htmlToText(raw) : '';
  }
  return htmlToText(textOf(value));
}

/** Plain text from an HTML description: tags out, paragraphs kept as line breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
}

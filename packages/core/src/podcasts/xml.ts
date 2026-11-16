import { XMLParser } from 'fast-xml-parser';

// Entities stay off: RSS text is decoded below, and no feed gets to define its own.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export type XmlNode = Record<string, unknown>;

export class FeedError extends Error {}

export function parseXml(xml: string): XmlNode {
  try {
    return parser.parse(xml) as XmlNode;
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

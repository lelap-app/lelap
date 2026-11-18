import { CONTENT_TYPES, type ContentType } from './protocol';

export type Extra = Record<string, string>;

/** `search=dune&skip=20`; keys sorted so equal extras give equal URLs (and cache hits). */
export function encodeExtra(extra: Extra): string {
  return Object.keys(extra)
    .filter((key) => extra[key] !== '')
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(extra[key] ?? '')}`)
    .join('&');
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// Query-string style: `+` is a space in extras, not in IDs.
const decodeExtra = (value: string) => decode(value.replace(/\+/g, ' '));

export function parseExtra(encoded: string): Extra {
  const extra: Extra = {};
  for (const pair of encoded.split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    extra[decodeExtra(at < 0 ? pair : pair.slice(0, at))] =
      at < 0 ? '' : decodeExtra(pair.slice(at + 1));
  }
  return extra;
}

const enc = encodeURIComponent;

export function catalogPath(type: ContentType, id: string, extra: Extra = {}): string {
  const encoded = encodeExtra(extra);
  return encoded ? `catalog/${type}/${enc(id)}/${encoded}.json` : `catalog/${type}/${enc(id)}.json`;
}

export function metaPath(type: ContentType, id: string): string {
  return `meta/${type}/${enc(id)}.json`;
}

export function streamPath(type: ContentType, id: string): string {
  return `stream/${type}/${enc(id)}.json`;
}

export function artworkPath(type: ContentType, id: string): string {
  return `artwork/${type}/${enc(id)}.json`;
}

/** Since revision 5: every file of the listener's library, from an add-on inside the app. */
export function libraryPath(type: ContentType = 'audiobook'): string {
  return `library/${type}/all.json`;
}

export type Route =
  | { resource: 'manifest' }
  | { resource: 'catalog'; type: ContentType; id: string; extra: Extra }
  | { resource: 'meta' | 'stream' | 'artwork' | 'library'; type: ContentType; id: string };

const isType = (value: string): value is ContentType =>
  (CONTENT_TYPES as readonly string[]).includes(value);

/** Parses a path relative to the add-on's base, such as `catalog/audiobook/new.json`. */
export function parseRoute(path: string): Route | null {
  const clean = path.replace(/^\/+/, '');
  if (clean === 'manifest.json') return { resource: 'manifest' };
  if (!clean.endsWith('.json')) return null;
  // Extras stay encoded until parseExtra, so `&` and `=` inside values survive.
  const [resource, rawType, rawId, extra, ...rest] = clean.slice(0, -'.json'.length).split('/');
  if (rest.length > 0 || !rawType || !rawId) return null;
  const type = decode(rawType);
  const id = decode(rawId);
  if (!isType(type)) return null;
  if (resource === 'catalog') return { resource, type, id, extra: parseExtra(extra ?? '') };
  if (
    (resource === 'meta' ||
      resource === 'stream' ||
      resource === 'artwork' ||
      resource === 'library') &&
    extra === undefined
  )
    return { resource, type, id };
  return null;
}

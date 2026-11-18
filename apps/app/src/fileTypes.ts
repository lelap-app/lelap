/** The media type of a file Lelap saves or shares, from its name. */
export function mimeTypeOf(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.opml')) return 'text/x-opml';
  return 'application/octet-stream';
}

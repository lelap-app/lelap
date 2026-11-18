/** The media type of a file Lelap saves or shares, from its name. */
export function mimeTypeOf(name: string): string {
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.opml')) return 'text/x-opml';
  if (name.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

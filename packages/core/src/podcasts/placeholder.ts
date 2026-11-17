/**
 * A feed on a reserved `.invalid` host (RFC 2606), such as the test library's: never fetched,
 * downloaded or synced, so a made-up library sends no requests anywhere.
 */
export function isPlaceholderFeed(feedUrl: string): boolean {
  try {
    const host = new URL(feedUrl).hostname.toLowerCase();
    return host === 'invalid' || host.endsWith('.invalid');
  } catch {
    return false;
  }
}

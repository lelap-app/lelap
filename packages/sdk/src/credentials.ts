// Web APIs every supported runtime has, typed here because some workspace packages compile the
// SDK without the DOM library.
type Globals = {
  crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  TextEncoder: new () => { encode(text: string): Uint8Array };
  console: { log(line: string): void };
};
const web = globalThis as unknown as Globals;

/**
 * A short, stable hash of a secret (16 hex characters of SHA-256), for cache keys and log lines
 * that must differ per account without holding the token itself.
 */
export async function fingerprint(secret: string): Promise<string> {
  const digest = await web.crypto.subtle.digest('SHA-256', new web.TextEncoder().encode(secret));
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type LogValue = string | number | boolean;

const MAX_LOG_STRING = 200;

/** A URL loses its query, fragment and login; other strings are cut at 200 characters. */
function safeString(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname}`.slice(0, MAX_LOG_STRING);
    } catch {
      return '[unreadable URL]';
    }
  }
  return value.length > MAX_LOG_STRING ? `${value.slice(0, MAX_LOG_STRING)}…` : value;
}

/**
 * Prints one JSON line: `{"event": …, …fields}`. Only strings, numbers and booleans are taken, so
 * an error object or a request that echoes a key can't be printed by accident; anything else is
 * printed as `"[dropped]"`. URLs lose their query and login, where keys usually ride.
 */
export function log(event: string, fields: Record<string, LogValue> = {}): void {
  const line: Record<string, LogValue> = { event: safeString(String(event)) };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'event') continue;
    line[key] =
      typeof value === 'string'
        ? safeString(value)
        : typeof value === 'number' || typeof value === 'boolean'
          ? value
          : '[dropped]';
  }
  web.console.log(JSON.stringify(line));
}

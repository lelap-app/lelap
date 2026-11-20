import { RETRY_AFTER_MAX_S, RETRY_AFTER_MIN_S, type Stream } from '@lelap/sdk';

/** How long the player keeps asking a preparing stream while the listener waits (M152). */
export const PREPARING_WAIT_MS = 10 * 60 * 1000;
/** The longest answer body shown as the reason a stream won't come. */
export const END_MESSAGE_MAX = 200;
const PROBE_TIMEOUT_MS = 8000;

/**
 * Seconds from a `Retry-After` header, as seconds or an HTTP date, held between 5 seconds and an
 * hour; null when there is none or it can't be read.
 */
export function retryAfterSeconds(header: string | null | undefined, nowMs: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  let seconds: number;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return null;
    seconds = Math.ceil((at - nowMs) / 1000);
  }
  return Math.min(RETRY_AFTER_MAX_S, Math.max(RETRY_AFTER_MIN_S, seconds));
}

/**
 * The add-on's own words for why a stream won't come: a plain-text body of at most 200
 * characters, else null so the app says it in its own words.
 */
export function endMessage(contentType: string | null, body: string | null): string | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'text/plain') return null;
  const text = body?.trim() ?? '';
  // Control characters other than line breaks: not words to show.
  const controls = [...text].some((c) => c < ' ' && c !== '\n');
  if (text.length === 0 || text.length > END_MESSAGE_MAX || controls) return null;
  return text;
}

export type StreamState =
  | { state: 'ready' }
  | { state: 'preparing'; seconds: number }
  /** `404` or `410`: it won't come. `message` is the add-on's, when it gave a short one. */
  | { state: 'gone'; status: number; message: string | null };

/** What a probe needs from `fetch`: the status, two headers and the body as text. */
export type ProbeFetcher = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; cache?: 'no-store' },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/** The first part's address, or the file's; null for audio that isn't on the web. */
export function streamProbeUrl(stream: Stream): string | null {
  const url = 'parts' in stream ? stream.parts[0]?.url : stream.url;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * Asks for a stream's first byte to learn whether it is ready (M152). Anything but `503` with
 * `Retry-After`, `404` or `410` counts as ready, also a failed request (the web app can't read
 * an answer without CORS): the player then gives its own error.
 */
export async function probeStream(
  fetcher: ProbeFetcher,
  url: string,
  nowMs: number,
  headers: Record<string, string> = {},
): Promise<StreamState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { ...headers, Range: 'bytes=0-0' },
      cache: 'no-store',
    });
    if (response.status === 503) {
      const seconds = retryAfterSeconds(response.headers.get('retry-after'), nowMs);
      return seconds === null ? { state: 'ready' } : { state: 'preparing', seconds };
    }
    if (response.status === 404 || response.status === 410) {
      const body = await response.text().catch(() => null);
      return {
        state: 'gone',
        status: response.status,
        message: endMessage(response.headers.get('content-type'), body),
      };
    }
    return { state: 'ready' };
  } catch {
    return { state: 'ready' };
  } finally {
    clearTimeout(timer);
    // Only the status was wanted; the rest of the file stays on the server.
    controller.abort();
  }
}

/**
 * When the player asks a preparing part again (M155): [seconds] from now, or null once that
 * would be more than 10 minutes after it first said so, when it shows an error instead.
 */
export function preparingRetryAt(sinceMs: number, nowMs: number, seconds: number): number | null {
  const at = nowMs + seconds * 1000;
  return at - sinceMs > PREPARING_WAIT_MS ? null : at;
}

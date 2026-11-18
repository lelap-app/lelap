import {
  ADDON_RESOURCES,
  type AddonResource,
  ERROR_NAMES,
  type ErrorName,
  type Reason,
} from './events';

/** An error reduced to what a report may show. The message is read here and never kept. */
export type ErrorClass = { reason: Reason; status: number | null; name: ErrorName };

const NAMES = new Set<string>(ERROR_NAMES);

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function errorName(error: unknown): ErrorName {
  const name = field(error, 'name');
  return typeof name === 'string' && NAMES.has(name) ? (name as ErrorName) : 'Error';
}

function errorStatus(error: unknown, message: string): number | null {
  const status = field(error, 'status');
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600) {
    return status;
  }
  // Only a number that sits next to a word saying it is one: a path may hold digits too.
  const match = /\b(?:HTTP|status|answered|code)\s*:?\s*([1-5]\d\d)\b/i.exec(message);
  return match ? Number(match[1]) : null;
}

function reasonFor(status: number | null, name: ErrorName, message: string): Reason {
  if (status === 401 || status === 403) return 'refused';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 408 || status === 504) return 'timeout';
  if (status !== null && status >= 500) return 'server';
  if (status !== null && status >= 400) return 'http';
  if (name === 'TimeoutError' || /time[sd]? ?out|took too long/i.test(message)) return 'timeout';
  if (name === 'AbortError' || /\b(?:abort|cancel)/i.test(message)) return 'cancelled';
  if (name === 'QuotaExceededError' || /no space|ENOSPC|quota|storage is full/i.test(message)) {
    return 'storage';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (/\bCORS\b|does not allow|not allowed by/i.test(message)) return 'blocked';
  if (/permission|denied|EACCES/i.test(message)) return 'permission';
  if (name === 'NotSupportedError' || /not supported|unsupported/i.test(message)) {
    return 'unsupported';
  }
  if (
    /network|offline|failed to fetch|could not be reached|unreachable|ENOTFOUND|ECONNREFUSED|ECONNRESET|resolve host|connection/i.test(
      message,
    )
  ) {
    return 'offline';
  }
  if (
    name === 'SyntaxError' ||
    name === 'ZodError' ||
    /JSON|parse|unexpected token|malformed|invalid xml|not readable xml|not an RSS or Atom/i.test(
      message,
    )
  ) {
    return 'unreadable';
  }
  return 'unknown';
}

/** Sorts an error into a reason, an HTTP status and a class name; its text is dropped. */
export function classifyError(error: unknown): ErrorClass {
  const raw = typeof error === 'string' ? error : field(error, 'message');
  const message = typeof raw === 'string' ? raw : '';
  const name = errorName(error);
  const status = errorStatus(error, message);
  return { reason: reasonFor(status, name, message), status, name };
}

/** Which add-on resource a request asked for, from its path only. */
export function addonResource(url: string): AddonResource {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  if (path.endsWith('/manifest.json')) return 'manifest';
  if (path.endsWith('/health')) return 'health';
  if (path.endsWith('/scrobble')) return 'scrobble';
  const match =
    /\/(catalog|meta|stream)\/(?:audiobook|podcast|episode)\/[^/]+(?:\/[^/]*)?\.json$/.exec(path);
  const kind = match?.[1];
  return kind && (ADDON_RESOURCES as readonly string[]).includes(kind)
    ? (kind as AddonResource)
    : 'other';
}

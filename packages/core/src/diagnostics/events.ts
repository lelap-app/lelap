import { z } from 'zod';

// Every field of an event is a word from a fixed list, a number, or a row ID. There is no field
// a title, a path, an address or a message could go into, so the log can't hold one.

/** What went wrong, worked out from an error without keeping its text. */
export const REASONS = [
  'offline',
  'timeout',
  'refused',
  'not-found',
  'server',
  'http',
  'blocked',
  'unreadable',
  'storage',
  'permission',
  'cancelled',
  'unsupported',
  'unknown',
] as const;
export type Reason = (typeof REASONS)[number];

/** Error class names a report may show; any other name reads as `Error`. */
export const ERROR_NAMES = [
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
  'NotAllowedError',
  'NotSupportedError',
  'NotFoundError',
  'NotReadableError',
  'QuotaExceededError',
  'SecurityError',
  'InvalidStateError',
  'DataError',
  'ZodError',
  'SyncError',
] as const;
export type ErrorName = (typeof ERROR_NAMES)[number];

/**
 * Player events, the same words from the Android service and the web player. Only trouble and
 * the system stopping playback: a timer running out or a book ending would say when someone
 * listens and sleeps, so those are not logged.
 */
export const PLAYER_EVENTS = [
  'error',
  'play-refused',
  'link-refreshed',
  'paused-by-system',
  'focus-lost',
  'focus-lost-briefly',
  'focus-ducked',
] as const;
export type PlayerEventName = (typeof PLAYER_EVENTS)[number];

export const SOURCES = [
  'folder',
  'webdav',
  'smb',
  'sftp',
  's3',
  'jellyfin',
  'audiobookshelf',
  'addon',
] as const;
export const ADDON_RESOURCES = [
  'manifest',
  'catalog',
  'meta',
  'stream',
  'health',
  'scrobble',
  'other',
] as const;
export type AddonResource = (typeof ADDON_RESOURCES)[number];

/** A row ID from this device's database. Reports never print it; they print `book#1`. */
const Ref = z.string().min(1).max(200);
const Count = z.number().int().min(0).max(10_000_000);
const Status = z.number().int().min(100).max(599);
const Code = z.number().int().min(-1_000_000).max(1_000_000);
const Reason = z.enum(REASONS);

export const DiagnosticEvent = z.discriminatedUnion('area', [
  z.strictObject({
    area: z.literal('player'),
    what: z.enum(PLAYER_EVENTS),
    platform: z.enum(['android', 'web']),
    /** Media3's `errorCode` or play-when-ready reason, or the web's `MediaError.code`. */
    code: Code.optional(),
    status: Status.optional(),
    book: Ref.optional(),
    part: Count.optional(),
  }),
  z.strictObject({
    area: z.literal('download'),
    what: z.literal('failed'),
    reason: Reason.optional(),
    status: Status.optional(),
    book: Ref.optional(),
  }),
  z.strictObject({
    area: z.literal('scan'),
    what: z.literal('failed'),
    source: z.enum(SOURCES),
    server: Ref.optional(),
    reason: Reason.optional(),
    status: Status.optional(),
  }),
  z.strictObject({
    area: z.literal('addon'),
    what: z.literal('failed'),
    addon: Ref,
    resource: z.enum(ADDON_RESOURCES),
    reason: Reason,
    status: Status.optional(),
  }),
  z.strictObject({
    area: z.literal('sync'),
    what: z.literal('failed'),
    reason: Reason.optional(),
    status: Status.optional(),
  }),
  z.strictObject({
    area: z.literal('app'),
    what: z.enum(['error', 'unhandled-rejection']),
    name: z.enum(ERROR_NAMES).optional(),
    reason: Reason.optional(),
    fatal: z.boolean().optional(),
  }),
]);
export type DiagnosticEvent = z.infer<typeof DiagnosticEvent>;

/** One player event as the Android service or the web player keeps it. */
export type NativePlayerEvent = {
  at: number;
  what: string;
  code?: number | null;
  status?: number | null;
  bookId?: string | null;
  part?: number | null;
};

/** A player event from native code, or `null` when it is not one Lelap knows. */
export function playerEvent(
  raw: NativePlayerEvent,
  platform: 'android' | 'web',
): { at: number; event: DiagnosticEvent } | null {
  if (!Number.isFinite(raw.at)) return null;
  const parsed = DiagnosticEvent.safeParse({
    area: 'player',
    what: raw.what,
    platform,
    ...(raw.code != null ? { code: raw.code } : {}),
    ...(raw.status != null ? { status: raw.status } : {}),
    ...(raw.bookId ? { book: raw.bookId } : {}),
    ...(raw.part != null && raw.part >= 0 ? { part: raw.part } : {}),
  });
  return parsed.success ? { at: raw.at, event: parsed.data } : null;
}

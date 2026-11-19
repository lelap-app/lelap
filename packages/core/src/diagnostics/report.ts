import { count } from 'drizzle-orm';

import type { AddonHealth, HealthState } from '../addons/health';
import { healthState } from '../addons/health';
import { listAddons } from '../addons/repository';
import type { Db } from '../db';
import { listRoots } from '../library/scan';
import { books, downloads, podcasts } from '../schema';
import type { Settings } from '../settings';
import { getMembership } from '../sync/engine';
import type { DiagnosticEvent } from './events';
import { diagnosticsOn, listDiagnostics, type StoredDiagnostic } from './log';

export type DiagnosticsApp = {
  version: string;
  platform: 'android' | 'web';
  /** Android's API level; null on the web, where a browser's version would only fingerprint. */
  androidApi: number | null;
};

type Source = 'folder' | 'webdav' | 'smb' | 'sftp' | 's3' | 'jellyfin' | 'audiobookshelf' | 'addon';

/** What a report says about the device, apart from the log. IDs are row IDs, never printed. */
export type DiagnosticsContext = {
  app: DiagnosticsApp;
  settings: [string, boolean | number | string][];
  library: {
    books: number;
    podcasts: number;
    downloads: Record<'queued' | 'done' | 'failed', number>;
  };
  servers: {
    id: string;
    source: Source;
    needsLogin: boolean;
    keyRefused: boolean;
    lastScanAt: number | null;
  }[];
  addons: {
    id: string;
    builtin: boolean;
    state: HealthState;
    latencyMs: number | null;
    errorStatus: number | null;
    errorAt: number | null;
    reported: string | null;
  }[];
  sync: { on: boolean; lastSyncAt: number | null };
  logOn: boolean;
};

// Settings worth knowing for a bug. The bedtime window is left out: it says when someone sleeps.
const SETTINGS: Exclude<keyof Settings, 'customTheme' | 'playerPaneWidth' | 'detailPaneWidth'>[] = [
  'language',
  'skipIntervalMs',
  'duckOnInterruption',
  'duckPercent',
  'smartRewind',
  'mono',
  'voiceEq',
  'skipSilence',
  'evenLoudness',
  'volumeBoost',
  'downloadOnWifiOnly',
  'downloadWhileChargingOnly',
  'bedtimeTimer',
  'shakeToExtend',
  'headphoneBattery',
  'carModeOffer',
  'homeSuggestions',
  'betaUpdates',
  'otaUpdates',
];

/** Reads what a report says about the device. Names, addresses and logins are not read out. */
export function diagnosticsContext(
  db: Db,
  input: { app: DiagnosticsApp; settings: Settings; health: (addonUrl: string) => AddonHealth },
): DiagnosticsContext {
  const states = { queued: 0, done: 0, failed: 0 };
  for (const row of db
    .select({ state: downloads.state, n: count() })
    .from(downloads)
    .groupBy(downloads.state)
    .all()) {
    states[row.state] = row.n;
  }
  const membership = getMembership(db);
  return {
    app: input.app,
    settings: SETTINGS.map((key) => [key, input.settings[key]]),
    library: {
      books: db.select({ n: count() }).from(books).get()?.n ?? 0,
      podcasts: db.select({ n: count() }).from(podcasts).get()?.n ?? 0,
      downloads: states,
    },
    servers: listRoots(db).map((root) => ({
      id: root.id,
      source: root.remote?.type ?? 'folder',
      needsLogin: root.needsLogin,
      keyRefused: root.remote?.type === 'audiobookshelf' && root.remote.keyRefused === true,
      lastScanAt: root.lastScanAt,
    })),
    addons: listAddons(db).map((addon) => {
      const health = input.health(addon.url);
      return {
        id: addon.id,
        builtin: addon.builtin,
        state: healthState(health),
        latencyMs: health.lastLatencyMs,
        errorStatus: health.lastError?.status ?? null,
        errorAt: health.lastError?.at ?? null,
        // The add-on's own words are its author's text, so only the status word is kept.
        reported: health.reported?.status ?? null,
      };
    }),
    sync: { on: membership !== null, lastSyncAt: membership?.lastSyncAt ?? null },
    logOn: diagnosticsOn(db),
  };
}

/** Numbers items in the order a report first names them: `book#1`, `server#2`. */
class Pseudonyms {
  private readonly maps = new Map<string, Map<string, number>>();

  name(kind: string, id: string): string {
    let map = this.maps.get(kind);
    if (!map) this.maps.set(kind, (map = new Map()));
    let n = map.get(id);
    if (n === undefined) map.set(id, (n = map.size + 1));
    return `${kind}#${n}`;
  }
}

/** Media3's `PlaybackException` codes, for reading a report without looking them up. */
const MEDIA3_ERRORS: Record<number, string> = {
  1000: 'UNSPECIFIED',
  1001: 'REMOTE_ERROR',
  1002: 'BEHIND_LIVE_WINDOW',
  1003: 'TIMEOUT',
  1004: 'FAILED_RUNTIME_CHECK',
  2000: 'IO_UNSPECIFIED',
  2001: 'IO_NETWORK_CONNECTION_FAILED',
  2002: 'IO_NETWORK_CONNECTION_TIMEOUT',
  2003: 'IO_INVALID_HTTP_CONTENT_TYPE',
  2004: 'IO_BAD_HTTP_STATUS',
  2005: 'IO_FILE_NOT_FOUND',
  2006: 'IO_NO_PERMISSION',
  2007: 'IO_CLEARTEXT_NOT_PERMITTED',
  2008: 'IO_READ_POSITION_OUT_OF_RANGE',
  3001: 'PARSING_CONTAINER_MALFORMED',
  3002: 'PARSING_MANIFEST_MALFORMED',
  3003: 'PARSING_CONTAINER_UNSUPPORTED',
  3004: 'PARSING_MANIFEST_UNSUPPORTED',
  4001: 'DECODER_INIT_FAILED',
  4002: 'DECODER_QUERY_FAILED',
  4003: 'DECODING_FAILED',
  4004: 'DECODING_FORMAT_EXCEEDS_CAPABILITIES',
  4005: 'DECODING_FORMAT_UNSUPPORTED',
  5001: 'AUDIO_TRACK_INIT_FAILED',
  5002: 'AUDIO_TRACK_WRITE_FAILED',
};

/** Media3's play-when-ready change reasons. */
const MEDIA3_REASONS: Record<number, string> = {
  1: 'USER_REQUEST',
  2: 'AUDIO_FOCUS_LOSS',
  3: 'AUDIO_BECOMING_NOISY',
  4: 'REMOTE',
  5: 'END_OF_MEDIA_ITEM',
  6: 'SUPPRESSED_TOO_LONG',
};

/** The web's `MediaError.code`. */
const MEDIA_ERRORS: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/** NsdManager's `FAILURE_*` codes, and the two the cast module adds for calls that went nowhere. */
const NSD_ERRORS: Record<number, string> = {
  [-2]: 'NO_ANSWER (-2)',
  [-1]: 'THREW (-1)',
  0: 'FAILURE_INTERNAL_ERROR (0)',
  3: 'FAILURE_ALREADY_ACTIVE (3)',
  4: 'FAILURE_MAX_LIMIT (4)',
  5: 'FAILURE_OPERATION_NOT_RUNNING (5)',
  6: 'FAILURE_BAD_PARAMETERS (6)',
  7: 'FAILURE_PERMISSION_DENIED (7)',
};

/** Why the web refused `play()`, as the code the web player records. */
export const PLAY_REFUSED: Record<string, number> = {
  NotAllowedError: 1,
  NotSupportedError: 2,
  AbortError: 3,
};
const PLAY_REFUSED_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(PLAY_REFUSED).map(([name, code]) => [code, name]),
);

function codeName(event: Extract<DiagnosticEvent, { area: 'player' }>): string | undefined {
  const code = event.code;
  if (code === undefined) return undefined;
  const table =
    event.what === 'paused-by-system'
      ? MEDIA3_REASONS
      : event.what === 'play-refused'
        ? PLAY_REFUSED_NAMES
        : event.platform === 'web'
          ? MEDIA_ERRORS
          : MEDIA3_ERRORS;
  return table[code] ? `${table[code]} (${code})` : `code ${code}`;
}

/**
 * How long before `now`, in whole hours: “under 1 h”, “3 h”, “2 d”. A reader knows when the file
 * was posted, so finer times would turn into clock times and say when someone listens or sleeps.
 */
export function ago(ms: number): string {
  const h = Math.floor(Math.max(0, ms) / 3_600_000);
  if (h < 1) return 'under 1 h';
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// A last guard: nothing above prints free text, but should a future event field do so, a line
// that looks like an address, a path, an email or a key is cut rather than shared.
const LEAKS = [
  /[a-z][a-z0-9+.-]*:\/\/\S*/gi,
  /\S+@\S+\.\S+/g,
  /(?:^|\s)~?\/[^\s/]+\/\S*/g,
  /(?=[A-Za-z0-9_+/=.-]*\d)(?=[A-Za-z0-9_+/=.-]*[A-Za-z])[A-Za-z0-9_+/=.-]{20,}/g,
  /\b[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}\b/g,
];

export function stripLeaks(line: string): string {
  return LEAKS.reduce((text, pattern) => text.replace(pattern, ' [removed]'), line);
}

function eventLine(event: DiagnosticEvent, names: Pseudonyms): string {
  const parts: string[] = [event.area, event.what];
  switch (event.area) {
    case 'player': {
      const code = codeName(event);
      if (code) parts.push(code);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      parts.push(event.platform);
      if (event.book) parts.push(names.name('book', event.book));
      if (event.part !== undefined) parts.push(`part ${event.part + 1}`);
      break;
    }
    case 'download':
      if (event.reason) parts.push(event.reason);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      if (event.book) parts.push(names.name('book', event.book));
      break;
    case 'scan':
      parts.push(event.source);
      if (event.server) parts.push(names.name('server', event.server));
      if (event.reason) parts.push(event.reason);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      break;
    case 'addon':
      parts.push(names.name('addon', event.addon), event.resource, event.reason);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      break;
    case 'sync':
      if (event.reason) parts.push(event.reason);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      break;
    case 'cast':
      parts.push(event.kind);
      if (event.code !== undefined) parts.push(NSD_ERRORS[event.code] ?? `code ${event.code}`);
      if (event.count !== undefined) parts.push(`×${event.count}`);
      break;
    case 'podcast':
      if (event.background) parts.push('background');
      if (event.count !== undefined) parts.push(`${event.count} feeds`);
      if (event.failed !== undefined) parts.push(`${event.failed} failed`);
      if (event.podcast) parts.push(names.name('podcast', event.podcast));
      if (event.reason) parts.push(event.reason);
      if (event.status !== undefined) parts.push(`HTTP ${event.status}`);
      break;
    case 'app':
      if (event.name) parts.push(event.name);
      if (event.reason) parts.push(event.reason);
      if (event.fatal) parts.push('fatal');
      break;
  }
  return parts.join('  ');
}

const onOff = (v: boolean | number | string) =>
  typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v);

/** The text of an export: the device, then the log, oldest first. */
export function formatReport(
  events: StoredDiagnostic[],
  context: DiagnosticsContext,
  now: number,
): string {
  const names = new Pseudonyms();
  const out: string[] = [
    'Lelap diagnostics',
    '',
    'Made on the device. No titles, file names, addresses, user names, keys or codes are in it.',
    'Books, servers and add-ons are numbered instead of named (book#1).',
    'Times count back from when the file was made, in whole hours; the log is oldest first.',
    '',
    '## App',
    `version  ${context.app.version}`,
    `platform  ${context.app.platform}${context.app.androidApi !== null ? ` (Android API ${context.app.androidApi})` : ''}`,
    `log  ${context.logOn ? 'on' : 'off'}`,
    '',
    '## Settings',
    ...context.settings.map(([key, value]) => `${key}  ${onOff(value)}`),
    '',
    '## Library',
    `books  ${context.library.books}`,
    `podcasts  ${context.library.podcasts}`,
    `downloads  ${context.library.downloads.done} done, ${context.library.downloads.queued} waiting, ${context.library.downloads.failed} failed`,
    '',
    '## Library folders and servers',
  ];
  if (context.servers.length === 0) out.push('none');
  for (const server of context.servers) {
    const parts = [names.name('server', server.id), server.source];
    if (server.needsLogin) parts.push('login needed');
    if (server.keyRefused) parts.push('key refused');
    parts.push(
      server.lastScanAt === null ? 'never scanned' : `scanned ${ago(now - server.lastScanAt)} ago`,
    );
    out.push(parts.join('  '));
  }
  out.push('', '## Add-ons');
  if (context.addons.length === 0) out.push('none');
  for (const addon of context.addons) {
    const parts = [
      names.name('addon', addon.id),
      addon.builtin ? 'built in' : 'added',
      addon.state,
    ];
    if (addon.latencyMs !== null) parts.push(`${addon.latencyMs} ms`);
    if (addon.errorAt !== null) {
      parts.push(
        `last failure ${addon.errorStatus !== null ? `HTTP ${addon.errorStatus} ` : ''}${ago(now - addon.errorAt)} ago`,
      );
    }
    if (addon.reported) parts.push(`says ${addon.reported}`);
    out.push(parts.join('  '));
  }
  out.push(
    '',
    '## Sync',
    context.sync.on
      ? `on  ${context.sync.lastSyncAt === null ? 'not synced yet' : `last synced ${ago(now - context.sync.lastSyncAt)} ago`}`
      : 'off',
    '',
    `## Log (${events.length})`,
  );
  if (events.length === 0) out.push('empty');
  for (const { at, event } of events) out.push(`${ago(now - at)} ago  ${eventLine(event, names)}`);
  return `${out.map(stripLeaks).join('\n')}\n`;
}

/** The whole export for this device: its context and the log. */
export function diagnosticsReport(
  db: Db,
  input: {
    app: DiagnosticsApp;
    settings: Settings;
    health: (addonUrl: string) => AddonHealth;
    now: number;
  },
): string {
  return formatReport(listDiagnostics(db), diagnosticsContext(db, input), input.now);
}

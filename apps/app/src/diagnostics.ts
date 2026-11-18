import {
  addonFailureEvent,
  appErrorEvent,
  type DiagnosticEvent,
  diagnosticsOn,
  listAddons,
  playerEvent,
  recordDiagnostic,
  setDiagnosticsOn,
} from '@lelap/core';
import { Platform } from 'react-native';

import { db } from './db';
import * as audio from './platform/audio';

// The diagnostics log (M47): off unless turned on in Settings, kept on this device, and only
// leaves it when the listener exports it. What goes in is in `@lelap/core`'s `DiagnosticEvent`.

let on = false;
let handlersInstalled = false;
// A dead add-on fails on every screen; one entry per kind of failure every few minutes is enough,
// so it can't push everything else out of the log.
const ADDON_REPEAT_MS = 5 * 60_000;
const addonSeen = new Map<string, number>();

export const isDiagnosticsOn = () => on;

/** Adds an event while the log is on; never throws, so logging can't break what it watches. */
export function logDiagnostic(event: DiagnosticEvent | null, at: number = Date.now()): void {
  if (!on || !event) return;
  try {
    recordDiagnostic(db, event, at);
  } catch {
    // A log that can't be written is not worth an error of its own.
  }
}

/** For the add-on health tracker: a failed request, named by the installed add-on. */
export function logAddonFailure(
  base: string,
  url: string,
  failure: { message: string; status: number | null },
): void {
  if (!on) return;
  try {
    const event = addonFailureEvent(listAddons(db), base, url, failure);
    if (event?.area !== 'addon') return;
    const key = `${event.addon} ${event.resource} ${event.reason} ${event.status ?? ''}`;
    const now = Date.now();
    if (now - (addonSeen.get(key) ?? -Infinity) < ADDON_REPEAT_MS) return;
    addonSeen.set(key, now);
    logDiagnostic(event);
  } catch {
    // Logging must not change how the add-on request ends.
  }
}

/** Moves the player's events (kept by the Android service or the web player) into the log. */
export async function pullPlayerEvents(): Promise<void> {
  if (!on) return;
  const platform = Platform.OS === 'web' ? 'web' : 'android';
  for (const raw of await audio.takeDiagnostics().catch(() => [])) {
    const parsed = playerEvent(raw, platform);
    try {
      if (parsed) recordDiagnostic(db, parsed.event, parsed.at);
    } catch {
      // One unwritable event does not cost the rest.
    }
  }
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = {
  getGlobalHandler: () => GlobalHandler;
  setGlobalHandler: (handler: GlobalHandler) => void;
};

/** Errors nothing else caught. The handlers stay; they log only while the log is on. */
function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  if (Platform.OS === 'web') {
    window.addEventListener('error', (e) => logDiagnostic(appErrorEvent(e.error, 'error')));
    window.addEventListener('unhandledrejection', (e) =>
      logDiagnostic(appErrorEvent(e.reason, 'unhandled-rejection')),
    );
    return;
  }
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    logDiagnostic(appErrorEvent(error, 'error', isFatal === true));
    previous(error, isFatal);
  });
}

/** Reads the switch once the database is open, and tells the player. */
export function startDiagnostics(): void {
  on = diagnosticsOn(db);
  installHandlers();
  void audio.setDiagnostics(on).catch(() => {});
  if (on) void pullPlayerEvents();
}

/** Turns the log on or off. Off empties it here and in the player. */
export async function setDiagnostics(next: boolean): Promise<void> {
  setDiagnosticsOn(db, next, Date.now());
  on = next;
  await audio.setDiagnostics(next).catch(() => {});
}

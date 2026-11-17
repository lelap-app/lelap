import { addonBase, type InstalledAddon } from '../addons/client';
import type { RemoteSource } from '../schema';
import { addonResource, classifyError } from './classify';
import type { DiagnosticEvent, Reason } from './events';

// Builders for the events the app records. Each takes an error as it comes and keeps only its
// class: the text of an error can hold an address, a login or a file name.

const withStatus = (status: number | null) => (status !== null ? { status } : {});

/** A failed add-on request, named by the installed add-on's row ID; null for one not installed. */
export function addonFailureEvent(
  installed: InstalledAddon[],
  base: string,
  url: string,
  failure: { message: string; status: number | null },
): DiagnosticEvent | null {
  const addon = installed.find((a) => addonBase(a.url) === base);
  if (!addon) return null;
  const { reason } = classifyError(failure);
  return {
    area: 'addon',
    what: 'failed',
    addon: addon.id,
    resource: addonResource(url),
    reason,
    ...withStatus(failure.status),
  };
}

/** A download the worker gave up on. `error` is the worker's message, read and dropped here. */
export function downloadFailureEvent(bookId: string, error: unknown): DiagnosticEvent {
  const { reason, status } = classifyError(error);
  return { area: 'download', what: 'failed', book: bookId, reason, ...withStatus(status) };
}

export function scanSource(remote: RemoteSource | null): 'folder' | RemoteSource['type'] {
  return remote?.type ?? 'folder';
}

/** A library folder or server that could not be listed or read. */
export function scanFailureEvent(
  rootId: string,
  remote: RemoteSource | null,
  error: unknown,
  /** When the caller knows better than the error's text, such as a folder Android took back. */
  known?: Reason,
): DiagnosticEvent {
  const { reason, status } = classifyError(error);
  return {
    area: 'scan',
    what: 'failed',
    source: scanSource(remote),
    server: rootId,
    reason: known ?? reason,
    ...withStatus(status),
  };
}

export function syncFailureEvent(error: unknown): DiagnosticEvent {
  const { reason, status } = classifyError(error);
  return { area: 'sync', what: 'failed', reason, ...withStatus(status) };
}

/** An error nothing else caught. Only its class name and reason are kept, never its stack. */
export function appErrorEvent(
  error: unknown,
  what: 'error' | 'unhandled-rejection',
  fatal = false,
): DiagnosticEvent {
  const { reason, name } = classifyError(error);
  return { area: 'app', what, name, reason, ...(fatal ? { fatal } : {}) };
}

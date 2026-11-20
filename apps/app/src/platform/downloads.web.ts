import { endMessage, integrityCheck, retryAfterSeconds, withoutDigestLogin } from '@lelap/core';

import { t } from '../i18n';
import type {
  DownloadJob,
  DownloadLocation,
  DownloadRules,
  DownloadStatus,
  StorageInfo,
} from '@lelap/download';

import * as opfs from './opfs';

export type { DownloadJob, DownloadLocation, DownloadRules, DownloadStatus, StorageInfo };

// Web downloads run in the page with fetch and write to OPFS: they stop when the tab closes and
// continue from the finished parts when it opens again, and wait while the browser is offline.
// Wi-Fi and charging rules don't apply; browsers don't say reliably whether a connection is
// metered.

export const RULES_APPLY = false;

/**
 * Asks the browser to keep its storage under pressure instead of clearing it. Chrome decides by
 * itself (an installed app gets it); Firefox asks the listener.
 */
export async function keepStorage(): Promise<boolean> {
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function storageKept(): Promise<boolean> {
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// A fetch whose connection went away can hang instead of failing: stop the downloads, so they
// show as waiting and start again from their finished files once the browser is back online.
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    for (const state of running.values()) state.controller.abort();
  });
}

const JOB_FILE = 'job.json';
// Why a download failed for good, so a new tab doesn't fetch the same wrong file again.
const FAILED_FILE = 'failed.txt';

/** A failure that trying again won't fix. */
class PermanentFailure extends Error {}

type Running = { bytesDone: number; controller: AbortController; received: boolean };
const running = new Map<string, Running>();
const errors = new Map<string, string>();

const bookDir = (bookId: string) => `${opfs.DOWNLOADS_DIR}/${bookId}`;

export function directory(): string {
  return opfs.DOWNLOADS_DIR;
}

async function writeText(path: string, text: string): Promise<void> {
  const writable = await (await opfs.fileHandle(path, true)).createWritable();
  await writable.write(text);
  await writable.close();
}

async function readJob(bookId: string): Promise<DownloadJob | null> {
  try {
    return JSON.parse(
      await (await opfs.readFile(`${bookDir(bookId)}/${JOB_FILE}`)).text(),
    ) as DownloadJob;
  } catch {
    return null;
  }
}

/**
 * Downloads one file; the browser cache and OPFS have no partial writes to resume from. A file
 * with an SRI hash (`podcast:integrity`, M121) is hashed part by part as it is written, so it
 * never sits in memory whole, and is not kept when it doesn't match.
 */
const waitFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });

async function fetchTo(
  url: string,
  path: string,
  signal: AbortSignal,
  onBytes: (n: number) => void,
  headers?: Record<string, string>,
  integrity?: string,
) {
  // A browser can't answer a Digest login (M135); it stays out of the request.
  const sent = headers ? withoutDigestLogin(headers) : undefined;
  let response = await fetch(url, { signal, ...(sent ? { headers: sent } : {}) });
  // A source still preparing the file (M152): wait as long as it says, while the page is open.
  for (;;) {
    const seconds =
      response.status === 503
        ? retryAfterSeconds(response.headers.get('retry-after'), Date.now())
        : null;
    if (seconds === null) break;
    await waitFor(seconds * 1000, signal);
    response = await fetch(url, { signal, ...(sent ? { headers: sent } : {}) });
  }
  if ((response.status === 404 || response.status === 410) && !response.ok) {
    const own = endMessage(
      response.headers.get('content-type'),
      await response.text().catch(() => null),
    );
    if (own) throw new Error(own);
  }
  if (!response.ok || !response.body)
    throw new Error(t('The server answered HTTP {status}.', { status: response.status }));
  const part = `${path}.part`;
  const writable = await (await opfs.fileHandle(part, true)).createWritable();
  const reader = response.body.getReader();
  const check = integrity ? integrityCheck(integrity) : null;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      check?.update(value);
      await writable.write(value);
      total += value.byteLength;
      onBytes(total);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  if (check && !check.matches()) {
    await opfs.remove(part);
    throw new PermanentFailure(
      t(
        'The file doesn’t match the checksum in the feed, so it was not kept. It may have changed on the way.',
      ),
    );
  }
  // OPFS has no rename in every browser yet: stream the finished part to its name.
  const file = await opfs.readFile(part);
  await file.stream().pipeTo(await (await opfs.fileHandle(path, true)).createWritable());
  await opfs.remove(part);
}

async function run(job: DownloadJob): Promise<void> {
  const dir = bookDir(job.bookId);
  const state: Running = { bytesDone: 0, controller: new AbortController(), received: false };
  running.set(job.bookId, state);
  errors.delete(job.bookId);
  try {
    let finished = 0;
    for (const file of job.files) {
      const path = `${dir}/${file.name}`;
      if (await opfs.exists(path)) {
        finished += (await opfs.readFile(path)).size;
        continue;
      }
      await fetchTo(
        file.url,
        path,
        state.controller.signal,
        (n) => {
          state.bytesDone = finished + n;
          state.received = true;
        },
        job.headers,
        file.integrity,
      );
      finished += (await opfs.readFile(path)).size;
    }
    if (job.cover && !(await opfs.exists(`${dir}/${job.cover.name}`))) {
      await fetchTo(
        job.cover.url,
        `${dir}/${job.cover.name}`,
        state.controller.signal,
        () => {},
      ).catch(() => {});
    }
  } catch (error) {
    // Offline, it waits and carries on with the next status poll once the connection is back. A
    // network error after data came in is a dropped connection, not CORS: the next poll retries.
    const dropped = error instanceof TypeError && state.received;
    if (error instanceof PermanentFailure && running.get(job.bookId) === state) {
      errors.set(job.bookId, error.message);
      await writeText(`${dir}/${FAILED_FILE}`, error.message).catch(() => {});
    } else if (!state.controller.signal.aborted && !offline() && !dropped) {
      errors.set(job.bookId, failure(error));
    }
  } finally {
    if (running.get(job.bookId) === state) running.delete(job.bookId);
  }
}

function failure(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return t('The browser’s storage is full. Remove a download to make room.');
  }
  // Most often a missing CORS header: the browser may play the file but not save it.
  if (error instanceof TypeError) {
    return t('The browser could not save this file; the source does not allow it.');
  }
  return error instanceof Error ? error.message : String(error);
}

export async function enqueue(job: DownloadJob): Promise<void> {
  running.get(job.bookId)?.controller.abort();
  await opfs.remove(`${bookDir(job.bookId)}/${FAILED_FILE}`);
  await writeText(`${bookDir(job.bookId)}/${JOB_FILE}`, JSON.stringify(job));
  void run(job);
}

export async function remove(bookId: string): Promise<void> {
  running.get(bookId)?.controller.abort();
  running.delete(bookId);
  errors.delete(bookId);
  await opfs.remove(bookDir(bookId));
}

export async function statuses(): Promise<DownloadStatus[]> {
  const result: DownloadStatus[] = [];
  for (const bookId of await opfs.list(opfs.DOWNLOADS_DIR)) {
    const job = await readJob(bookId);
    if (!job) continue;
    const dir = bookDir(bookId);
    const files: string[] = [];
    let bytes = 0;
    for (const file of job.files) {
      if (await opfs.exists(`${dir}/${file.name}`)) {
        files.push(file.name);
        bytes += (await opfs.readFile(`${dir}/${file.name}`)).size;
      }
    }
    const active = running.get(bookId);
    if (!active && !errors.has(bookId) && (await opfs.exists(`${dir}/${FAILED_FILE}`))) {
      errors.set(bookId, await (await opfs.readFile(`${dir}/${FAILED_FILE}`)).text());
    }
    const done = files.length === job.files.length && !active;
    const waiting = !done && !active && offline();
    if (!done && !active && !waiting && !errors.has(bookId)) void run(job);
    const error = errors.get(bookId) ?? null;
    result.push({
      bookId,
      state: done ? 'done' : error ? 'failed' : waiting ? 'waiting' : 'running',
      bytesDone: active?.bytesDone ?? bytes,
      bytesTotal: job.files.reduce((sum, f) => sum + f.size, 0),
      files,
      cover: job.cover && (await opfs.exists(`${dir}/${job.cover.name}`)) ? job.cover.name : null,
      error,
    });
  }
  return result;
}

export async function setRules(): Promise<void> {}

export async function storage(): Promise<StorageInfo> {
  const estimate = await navigator.storage.estimate();
  const quota = estimate.quota ?? 0;
  const used = estimate.usage ?? 0;
  return { freeBytes: Math.max(0, quota - used), totalBytes: quota, usedBytes: used };
}

// A browser keeps downloads in its own storage; there is no folder to choose.
export const CHOOSE_LOCATION = false;

export function location(): Promise<DownloadLocation> {
  return Promise.resolve({
    uri: null,
    volume: null,
    path: null,
    available: true,
    moving: false,
    waiting: 0,
    error: null,
  });
}

export const chooseLocation = (): Promise<boolean> => Promise.resolve(false);
export async function resetLocation(): Promise<void> {}
export async function resumeMove(): Promise<void> {}
export async function releaseOld(): Promise<void> {}

export const isIgnoringBatteryOptimizations = () => true;

export async function requestBatteryExemption(): Promise<void> {}

// A closed tab gets no background time, so the web app posts no notifications.
export function canNotify(): boolean {
  return false;
}

export function notify(): boolean {
  return false;
}

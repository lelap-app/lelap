import { t } from '../i18n';
import { bundledAddon, getLocalAddonCode, hostAllowed, listAddons } from '@lelap/core';
import { libraryPath, type Settings } from '@lelap/sdk';

import { db } from '../db';
import { sandboxPage } from './page';

// The app's side of in-app add-ons (M38). Each add-on runs in its own hidden sandbox (a WebView
// on Android, an iframe on the web), started when first needed. Calls go in as messages; the
// sandbox asks the app to fetch, and the app fetches only from the add-on's declared hosts.
// An add-on used as a library source (M57) gets a sandbox of its own per server, with that
// server's hosts, and its settings only in that sandbox's `library` calls.

const CALL_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_CHARS = 5_000_000;

type Call = {
  resolve: (r: { status: number; body: unknown }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type Box = {
  /** Changes when the sandbox is restarted, so the host mounts a fresh one. */
  key: string;
  id: string;
  html: string;
  hosts: string[];
  post: ((message: string) => void) | null;
  ready: boolean;
  /** The add-on runs in a worker, which can't navigate away with what it was given. */
  isolated: boolean;
  waiting: (() => void)[];
  calls: Map<string, Call>;
};

const boxes = new Map<string, Box>();
const listeners = new Set<() => void>();
let snapshot: Box[] = [];
let seq = 0;

const changed = () => {
  snapshot = [...boxes.values()];
  for (const l of listeners) l();
};

export const subscribeBoxes = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const currentBoxes = () => snapshot;

function open(id: string, code: string, hosts: string[]): Box {
  const box: Box = {
    key: `${id}#${++seq}`,
    id,
    html: sandboxPage(code),
    hosts,
    post: null,
    ready: false,
    isolated: false,
    waiting: [],
    calls: new Map(),
  };
  boxes.set(id, box);
  changed();
  return box;
}

/** Closes an add-on's sandbox and those of every server it lists. */
export function closeSandboxesOf(manifestUrl: string): void {
  for (const id of [...boxes.keys()]) {
    if (id === manifestUrl || id.startsWith(`${manifestUrl}#`)) closeSandbox(id);
  }
}

/** Closes a sandbox, such as after its add-on is removed or updated. */
export function closeSandbox(id: string): void {
  const box = boxes.get(id);
  if (!box) return;
  for (const call of box.calls.values()) {
    clearTimeout(call.timer);
    call.reject(new Error(t('The add-on stopped.')));
  }
  boxes.delete(id);
  changed();
}

/** The host component hands over how to talk to a mounted sandbox. */
export function attachSandbox(key: string, post: (message: string) => void): void {
  for (const box of boxes.values()) if (box.key === key) box.post = post;
}

async function fetchFor(box: Box, id: string, url: string, init: RequestInit | undefined) {
  const reply = (m: Record<string, unknown>) =>
    box.post?.(JSON.stringify({ t: 'fetched', id, ...m }));
  if (!hostAllowed(url, box.hosts)) {
    reply({
      error: `Not allowed: this add-on may only reach ${box.hosts.join(', ') || 'nothing'}.`,
    });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      signal: controller.signal,
      // Never the app's own cookies or credentials.
      credentials: 'omit',
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error(t('The answer was too large.'));
    const type = response.headers.get('content-type');
    reply({ status: response.status, text, headers: type ? { 'content-type': type } : {} });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}

/** A message from a sandbox, as the host component received it. */
export function sandboxMessage(key: string, data: string): void {
  const box = [...boxes.values()].find((b) => b.key === key);
  if (!box) return;
  let m: {
    t?: string;
    id?: string;
    isolated?: boolean;
    status?: number;
    body?: unknown;
    url?: string;
    init?: RequestInit;
  };
  try {
    m = JSON.parse(data) as typeof m;
  } catch {
    return;
  }
  if (m.t === 'ready') {
    if (box.ready) return;
    box.ready = true;
    box.isolated = m.isolated === true;
    for (const go of box.waiting.splice(0)) go();
  } else if (m.t === 'result' && m.id) {
    const call = box.calls.get(m.id);
    if (!call) return;
    box.calls.delete(m.id);
    clearTimeout(call.timer);
    call.resolve({ status: m.status ?? 500, body: m.body });
  } else if (m.t === 'fetch' && m.id && typeof m.url === 'string') {
    void fetchFor(box, m.id, m.url, m.init);
  }
}

/** An add-on's code and manifest: bundled with the app first, else installed from a file. */
function codeOf(manifestUrl: string) {
  const bundled = bundledAddon(manifestUrl);
  if (bundled) return { code: bundled.code, manifest: bundled.manifest };
  const stored = getLocalAddonCode(db, manifestUrl);
  const addon = listAddons(db).find((a) => a.url === manifestUrl);
  return stored && addon ? { code: stored.code, manifest: addon.manifest } : null;
}

function boxFor(manifestUrl: string): Box | null {
  const existing = boxes.get(manifestUrl);
  if (existing) return existing;
  const found = codeOf(manifestUrl);
  if (!found) return null;
  return open(manifestUrl, found.code, found.manifest.sandbox?.hosts ?? []);
}

async function call(
  box: Box,
  path: string,
  settings?: Settings,
): Promise<{ status: number; body: unknown }> {
  if (!box.ready || !box.post) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t('The add-on did not start.'))),
        CALL_TIMEOUT_MS,
      );
      box.waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  // A login reaches only code that can't carry it off by navigating somewhere else.
  if (settings && !box.isolated) {
    throw new Error(t('This add-on needs a login, which this device can’t keep apart from it.'));
  }
  const id = `c${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      box.calls.delete(id);
      reject(new Error(t('The add-on did not answer in time.')));
    }, CALL_TIMEOUT_MS);
    box.calls.set(id, { resolve, reject, timer });
    box.post?.(JSON.stringify({ t: 'call', id, path, ...(settings ? { settings } : {}) }));
  });
}

/** Calls a route of an installed in-app add-on, such as `catalog/audiobook/all.json`. */
export async function callLocalAddon(
  manifestUrl: string,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const box = boxFor(manifestUrl);
  if (!box) throw new Error(t('This add-on is not on this device.'));
  return call(box, path);
}

/**
 * Asks an add-on for one server's library, in that server's own sandbox: it may reach only
 * `hosts`, and it is the only one to get `settings`. `sandboxId` names the server, such as
 * `<manifest URL>#<root ID>`; a sandbox whose hosts changed is started again.
 */
export async function callAddonLibrary(args: {
  addonUrl: string;
  sandboxId: string;
  hosts: string[];
  settings: Settings;
}): Promise<{ status: number; body: unknown }> {
  const found = codeOf(args.addonUrl);
  if (!found) throw new Error(t('This add-on is not on this device.'));
  const id = `${args.addonUrl}#${args.sandboxId}`;
  let box = boxes.get(id);
  if (box && box.hosts.join(' ') !== args.hosts.join(' ')) {
    closeSandbox(id);
    box = undefined;
  }
  box ??= open(id, found.code, args.hosts);
  return call(box, libraryPath(), args.settings);
}

/** Runs code that isn't installed yet, with no network, to read its manifest. */
export async function previewManifest(code: string): Promise<unknown> {
  const id = `preview:${++seq}`;
  const box = open(id, code, []);
  try {
    const result = await call(box, 'manifest.json');
    if (result.status !== 200) throw new Error(t('The file has no manifest.'));
    return result.body;
  } finally {
    closeSandbox(id);
  }
}

import { t } from '../i18n';
import {
  bundledAddon,
  fetchLimit,
  getLocalAddonCode,
  listAddons,
  sandboxFetch,
  type SandboxFetchInit,
} from '@lelap/core';
import {
  libraryPath,
  type LocateRequest,
  locatePath,
  type PlaceReport,
  placePath,
  type ScrobbleEvent,
  scrobblePath,
  type Settings,
  signinPath,
} from '@lelap/sdk';

import { db } from '../db';
import { addonManualFetch } from '../platform/addonFetch';
import { screenlessSandbox } from '../platform/headless';
import { sandboxPage } from './page';

// The app's side of in-app add-ons (M38). Each add-on runs in its own hidden sandbox (a WebView
// on Android, an iframe on the web), started when first needed. Calls go in as messages; the
// sandbox asks the app to fetch, and the app fetches only from the add-on's declared hosts.
// An add-on used as a library source (M57) gets a sandbox of its own per server, with that
// server's hosts, and its settings only in that sandbox's `library` and `place` calls. An add-on
// set up with settings under Settings → Library and sources → Add-ons (M61, M66) gets one sandbox for all its calls.
// While no screen is up to hold the WebView, such as in the background refresh, the page runs in
// one that needs no screen (M123, `@lelap/headless`): the same page, settings and fetch rules.

const CALL_TIMEOUT_MS = 20_000;
// A library listing may take many requests, such as one per album on a Subsonic server: thousands
// of albums at six at a time. Each request still gives up after 20 s, so a server that stops
// answering ends the listing long before this.
const LIBRARY_TIMEOUT_MS = 10 * 60_000;
// A place report may first have to find the server, at home or away, or list it again.
const PLACE_TIMEOUT_MS = 60_000;
// The listener waits for this one: a book doesn't start until it answers or gives up.
const LOCATE_TIMEOUT_MS = 8_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_CHARS = 5_000_000;
// Fetches in flight per add-on, across its sandboxes; the rest wait their turn. A library listing
// runs six at a time.
const PARALLEL_FETCHES = 6;

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
  /** The hosts among `hosts` the listener typed, which may be on the home network. */
  typed: string[];
  post: ((message: string) => void) | null;
  ready: boolean;
  /** The add-on runs in a worker, which can't navigate away with what it was given. */
  isolated: boolean;
  /** Runs in a WebView without a screen (M123), not in the host component's. */
  screenless: boolean;
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

// Host components mounted now; without one, a new sandbox runs without a screen where it can.
let screens = 0;
let listening = false;

/** The host component is up; the function it returns says it went. */
export function screenMounted(): () => void {
  screens++;
  return () => {
    screens--;
    // Its WebViews went with it, such as when the app is swiped away while the player plays on:
    // the next call starts one without a screen.
    if (screens > 0) return;
    for (const box of [...boxes.values()]) if (!box.screenless) closeSandbox(box.id);
  };
}

function open(id: string, code: string, hosts: string[], declared: string[] = hosts): Box {
  const box: Box = {
    key: `${id}#${++seq}`,
    id,
    html: sandboxPage(code),
    hosts,
    typed: hosts.filter((h) => !declared.includes(h)),
    post: null,
    ready: false,
    isolated: false,
    screenless: false,
    waiting: [],
    calls: new Map(),
  };
  const screenless = screens === 0 ? screenlessSandbox : null;
  if (screenless) {
    if (!listening) {
      listening = true;
      screenless.listen(sandboxMessage);
    }
    box.screenless = true;
    box.post = (message) => screenless.post(box.key, message);
    screenless.open(box.key, box.html);
  }
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
  if (box.screenless) screenlessSandbox?.close(box.key);
  boxes.delete(id);
  changed();
}

/** The host component hands over how to talk to a mounted sandbox. */
export function attachSandbox(key: string, post: (message: string) => void): void {
  for (const box of boxes.values()) if (box.key === key) box.post = post;
}

// React Native's own fetch follows every redirect, posted body and headers included; this one
// never does, and on Android it also keeps declared hosts off the home network.
const manualFetch = () =>
  addonManualFetch({
    timeoutMs: FETCH_TIMEOUT_MS,
    // A character is a byte or more.
    maxBytes: MAX_RESPONSE_CHARS * 4,
    tooLarge: t('The answer was too large.'),
  });

// One limit per add-on, shared by its sandboxes (`<manifest URL>#<server>`).
const limits = new Map<string, ReturnType<typeof fetchLimit>>();
const limitOf = (box: Box) => {
  const addon = box.id.split('#')[0] ?? box.id;
  let limit = limits.get(addon);
  if (!limit) {
    limit = fetchLimit(PARALLEL_FETCHES);
    limits.set(addon, limit);
  }
  return limit;
};

async function fetchFor(box: Box, id: string, url: string, init: SandboxFetchInit | undefined) {
  const reply = await limitOf(box)(() =>
    sandboxFetch(manualFetch(), url, init, box.hosts, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxChars: MAX_RESPONSE_CHARS,
      tooLarge: t('The answer was too large.'),
      typed: box.typed,
    }),
  );
  box.post?.(JSON.stringify({ t: 'fetched', id, ...reply }));
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
    init?: SandboxFetchInit;
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
  extra: {
    place?: PlaceReport;
    signin?: { state?: string };
    events?: ScrobbleEvent[];
    library?: { cursor?: string };
    locate?: LocateRequest;
    timeoutMs?: number;
  } = {},
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
    }, extra.timeoutMs ?? CALL_TIMEOUT_MS);
    box.calls.set(id, { resolve, reject, timer });
    box.post?.(
      JSON.stringify({
        t: 'call',
        id,
        path,
        ...(settings ? { settings } : {}),
        ...(extra.place ? { place: extra.place } : {}),
        ...(extra.signin ? { signin: extra.signin } : {}),
        ...(extra.events ? { events: extra.events } : {}),
        ...(extra.library ? { library: extra.library } : {}),
        ...(extra.locate ? { locate: extra.locate } : {}),
      }),
    );
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
  /** A page's `next` (revision 9), for the page after it. */
  cursor?: string;
}): Promise<{ status: number; body: unknown }> {
  return call(serverBox(args), libraryPath(), args.settings, {
    timeoutMs: LIBRARY_TIMEOUT_MS,
    library: args.cursor === undefined ? {} : { cursor: args.cursor },
  });
}

/**
 * Closes a server's sandbox once its listing is done, so a scan of several servers doesn't keep a
 * hidden WebView each. A place report or the next scan starts it again.
 */
export function closeServerSandbox(addonUrl: string, sandboxId: string): void {
  const id = `${addonUrl}#${sandboxId}`;
  const box = boxes.get(id);
  // A call still running, such as a place report, keeps it open.
  if (box && box.calls.size === 0) closeSandbox(id);
}

/** One server's sandbox, started again when its hosts changed. */
function serverBox(args: { addonUrl: string; sandboxId: string; hosts: string[] }): Box {
  const found = codeOf(args.addonUrl);
  if (!found) throw new Error(t('This add-on is not on this device.'));
  const id = `${args.addonUrl}#${args.sandboxId}`;
  let box = boxes.get(id);
  if (box && box.hosts.join(' ') !== args.hosts.join(' ')) {
    closeSandbox(id);
    box = undefined;
  }
  return box ?? open(id, found.code, args.hosts, found.manifest.sandbox?.hosts ?? []);
}

/**
 * Tells an add-on where the listener is in one of its server's books (revision 6), in that
 * server's own sandbox and with its settings, so it can save the place on the server.
 */
export async function callAddonPlace(args: {
  addonUrl: string;
  sandboxId: string;
  hosts: string[];
  settings: Settings;
  place: PlaceReport;
}): Promise<{ status: number; body: unknown }> {
  return call(serverBox(args), placePath(), args.settings, {
    place: args.place,
    timeoutMs: PLACE_TIMEOUT_MS,
  });
}

/**
 * Asks an add-on where a book of its server streams from now (revision 11), in that server's own
 * sandbox and with its settings, before the book plays.
 */
export async function callAddonLocate(args: {
  addonUrl: string;
  sandboxId: string;
  hosts: string[];
  settings: Settings;
  locate: LocateRequest;
}): Promise<{ status: number; body: unknown }> {
  return call(serverBox(args), locatePath(), args.settings, {
    locate: args.locate,
    timeoutMs: LOCATE_TIMEOUT_MS,
  });
}

/**
 * One step of an add-on's sign-in (revision 7) for a server being added: `start` gets the code to
 * show, `check` whether the listener entered it yet. In that server's own sandbox, with the form's
 * values so far.
 */
export async function callAddonSignin(args: {
  addonUrl: string;
  sandboxId: string;
  hosts: string[];
  settings: Settings;
  step: 'start' | 'check';
  state?: string;
}): Promise<{ status: number; body: unknown }> {
  return call(serverBox(args), signinPath(args.step), args.settings, {
    signin: args.state === undefined ? {} : { state: args.state },
  });
}

// The one sandbox of an add-on set up with settings: its scrobbles and, since revision 9, every
// other call go there, with the settings' hosts.
const SETTINGS_BOX = 'settings';

/**
 * Hands a scrobbler inside the app (revision 8) a batch of events with its settings, in a sandbox
 * of its own that reaches only `hosts`. No events is the check made when it is set up.
 */
export async function callAddonScrobble(args: {
  addonUrl: string;
  hosts: string[];
  settings: Settings;
  events: ScrobbleEvent[];
}): Promise<{ status: number; body: unknown }> {
  return call(
    serverBox({ addonUrl: args.addonUrl, sandboxId: SETTINGS_BOX, hosts: args.hosts }),
    scrobblePath(),
    args.settings,
    { events: args.events, timeoutMs: PLACE_TIMEOUT_MS },
  );
}

/**
 * Calls a route of an add-on set up with settings (revision 9), such as a catalog, with its
 * settings, in the same sandbox as its scrobbles.
 */
export async function callAddonWithSettings(args: {
  addonUrl: string;
  hosts: string[];
  settings: Settings;
  path: string;
}): Promise<{ status: number; body: unknown }> {
  return call(
    serverBox({ addonUrl: args.addonUrl, sandboxId: SETTINGS_BOX, hosts: args.hosts }),
    args.path,
    args.settings,
  );
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

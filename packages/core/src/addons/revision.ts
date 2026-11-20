import {
  LATEST_PROTOCOL_VERSION,
  type Manifest,
  needsNewerApp,
  PROTOCOL_HEADER,
  sendsAppProtocol,
} from '@lelap/sdk';

// Protocol revision 15 (M156): the app tells add-ons its revision, an add-on can name the lowest
// revision it works with, and one that answers `426 Upgrade Required` is left alone until the
// app's revision changes.

/** The protocol revision this app speaks: the newest the bundled SDK knows. */
export const APP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

/**
 * The header for a resource request to this add-on: `Lelap-Protocol` only when its manifest
 * declares revision 15 or higher, since on the web a custom header asks for a CORS preflight
 * that an older add-on may not answer. Never for the manifest itself or for audio.
 */
export function protocolHeaders(
  manifest: Manifest,
  app: number = APP_PROTOCOL_VERSION,
): Record<string, string> {
  return sendsAppProtocol(manifest) ? { [PROTOCOL_HEADER]: String(app) } : {};
}

/** Why the app asks an add-on nothing: too old for its `minProtocolVersion`, or it answered 426. */
export type AddonBlock =
  { kind: 'minimum'; minimum: number } | { kind: 'refused'; note: string | null };

/** A refusal kept for an add-on: the app's revision then, and the add-on's own words. */
export type Refusal = { revision: number; note: string | null };

/** Where refusals are kept between starts; the app passes the device's own store. */
export type RefusalStorage = {
  read(): Record<string, Refusal>;
  write(all: Record<string, Refusal>): void;
};

const isRefusal = (value: unknown): value is Refusal =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Refusal).revision === 'number' &&
  ((value as Refusal).note === null || typeof (value as Refusal).note === 'string');

/** Reads kept refusals from JSON, dropping anything that isn't one. */
export function parseRefusals(text: string | null): Record<string, Refusal> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, Refusal] => isRefusal(e[1])),
    );
  } catch {
    return {};
  }
}

const without = (all: Record<string, Refusal>, urls: string[]): Record<string, Refusal> =>
  Object.fromEntries(Object.entries(all).filter(([url]) => !urls.includes(url)));

/**
 * The add-ons that answered `426 Upgrade Required`, by manifest URL. Each is asked nothing more
 * while the app stays at the revision it refused; an app at another revision asks again.
 */
export class AddonRefusals {
  private entries: Record<string, Refusal> = {};
  private storage: RefusalStorage | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly app: number = APP_PROTOCOL_VERSION) {}

  /** Keeps refusals in `storage` from now on, starting with what it holds. */
  attach(storage: RefusalStorage): void {
    this.storage = storage;
    try {
      this.entries = storage.read();
    } catch {
      this.entries = {};
    }
    // A refusal of another revision is over: this app is newer (or older) than the one refused.
    const stale = Object.keys(this.entries).filter(
      (url) => this.entries[url]?.revision !== this.app,
    );
    if (stale.length > 0) {
      this.entries = without(this.entries, stale);
      this.save();
    }
    this.emit();
  }

  get(url: string): Refusal | null {
    const entry = this.entries[url];
    return entry && entry.revision === this.app ? entry : null;
  }

  record(url: string, note: string | null): void {
    const current = this.entries[url];
    if (current && current.revision === this.app && current.note === note) return;
    this.entries[url] = { revision: this.app, note };
    this.save();
    this.emit();
  }

  /** Forgets an add-on's refusal, such as when it is removed. */
  forget(url: string): void {
    if (!(url in this.entries)) return;
    this.entries = without(this.entries, [url]);
    this.save();
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private save() {
    try {
      this.storage?.write({ ...this.entries });
    } catch {
      // Kept in memory for this run; the add-on is asked once more next start.
    }
  }

  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

/** The app's refusals, shared by every request it makes to an add-on. */
export const addonRefusals = new AddonRefusals();

/**
 * Why the app asks this add-on nothing, or null when it may ask. `minProtocolVersion` comes
 * first: a refusal of an add-on the app is too old for anyway adds nothing.
 */
export function addonBlock(
  addon: { url: string; manifest: Manifest },
  refusals: AddonRefusals = addonRefusals,
  app: number = APP_PROTOCOL_VERSION,
): AddonBlock | null {
  if (needsNewerApp(addon.manifest, app))
    return { kind: 'minimum', minimum: addon.manifest.minProtocolVersion ?? app + 1 };
  const refused = refusals.get(addon.url);
  return refused ? { kind: 'refused', note: refused.note } : null;
}

/** The longest add-on note shown with a `426`; a longer body is left out. */
export const UPGRADE_NOTE_MAX = 200;

/**
 * The add-on's own words in a `426` answer: plain text of at most 200 characters, else null.
 * `contentType` is null where there is none to read, such as an add-on inside the app.
 */
export function upgradeNote(
  text: string | null | undefined,
  contentType: string | null,
): string | null {
  if (contentType !== null && !/^text\/plain\b/i.test(contentType.trim())) return null;
  const note = (text ?? '').trim();
  if (note === '' || note.length > UPGRADE_NOTE_MAX) return null;
  // Markup or JSON that came without a type is not something to show.
  if (/^[<{[]/.test(note)) return null;
  return note;
}

/** One setting on an add-on's configure page. */
export type ConfigField = {
  /** The key in the config object; letters, digits, `_` and `-`. */
  key: string;
  label: string;
  /** `password` values are never shown again on the page and need `secret` to be set. */
  type: 'text' | 'password' | 'select' | 'checkbox';
  required?: boolean;
  /** Choices for `select`. */
  options?: string[];
  default?: string | boolean;
  /** A short line under the field. */
  help?: string;
};

/** What the listener chose on the configure page. Checkboxes are booleans, the rest strings. */
export type Config = Record<string, string | boolean>;

// Web APIs every supported runtime has (Workers, Deno, Bun, Node 20+), typed here because some
// workspace packages compile the SDK without the DOM library.
type Bytes = Uint8Array<ArrayBuffer>;
type WebCrypto = {
  getRandomValues(array: Bytes): Bytes;
  subtle: {
    digest(algorithm: string, data: Bytes): Promise<ArrayBuffer>;
    importKey(
      format: 'raw',
      key: ArrayBuffer,
      algorithm: string,
      extractable: boolean,
      usages: string[],
    ): Promise<unknown>;
    encrypt(
      algorithm: { name: string; iv: Bytes },
      key: unknown,
      data: Bytes,
    ): Promise<ArrayBuffer>;
    decrypt(
      algorithm: { name: string; iv: Bytes },
      key: unknown,
      data: Bytes,
    ): Promise<ArrayBuffer>;
  };
};
type WebGlobals = {
  crypto: WebCrypto;
  btoa(data: string): string;
  atob(data: string): string;
  TextEncoder: new () => { encode(text: string): Bytes };
  TextDecoder: new () => { decode(bytes: ArrayBuffer | Bytes): string };
};
const web = globalThis as unknown as WebGlobals;
const crypto = {
  getRandomValues: (array: Bytes) => web.crypto.getRandomValues(array),
  get subtle() {
    return web.crypto.subtle;
  },
};
const btoa = (data: string) => web.btoa(data);
const atob = (data: string) => web.atob(data);
const utf8 = (text: string): Bytes => new web.TextEncoder().encode(text);
const fromUtf8 = (bytes: ArrayBuffer | Bytes): string => new web.TextDecoder().decode(bytes);

const ENCRYPTED = 'e1.';
const PLAIN = 'p1.';

/** Whether a path segment is a config token rather than a resource name. */
export function isConfigToken(segment: string): boolean {
  return /^(e1|p1)\.[A-Za-z0-9_-]+$/.test(segment);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Bytes | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function keyFor(secret: string): Promise<unknown> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function asConfig(value: unknown): Config | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const config: Config = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' && typeof entry !== 'boolean') return null;
    config[key] = entry;
  }
  return config;
}

/**
 * Turns a config into a URL-safe token. With `secret`, it is encrypted with AES-GCM (the add-on
 * alone can read it); without, it is only encoded, so anyone holding the URL can read it.
 */
export async function encodeConfig(config: Config, secret?: string): Promise<string> {
  const data = utf8(JSON.stringify(config));
  if (!secret) return PLAIN + toBase64Url(data);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), data),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return ENCRYPTED + toBase64Url(out);
}

/** Reads a token from `encodeConfig`; `null` when it is damaged or sealed with another secret. */
export async function decodeConfig(token: string, secret?: string): Promise<Config | null> {
  if (!isConfigToken(token)) return null;
  const bytes = fromBase64Url(token.slice(3));
  if (!bytes) return null;
  try {
    if (token.startsWith(PLAIN)) {
      // An encrypted-only add-on refuses plain tokens, so nobody can hand it a forged config.
      if (secret) return null;
      return asConfig(JSON.parse(fromUtf8(bytes)));
    }
    if (!secret || bytes.length < 13) return null;
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await keyFor(secret),
      bytes.slice(12),
    );
    return asConfig(JSON.parse(fromUtf8(opened)));
  } catch {
    return null;
  }
}

/** Checks a field list up front, so mistakes show when the add-on starts. */
export function checkFields(fields: ConfigField[], secret: string | undefined): void {
  const keys = new Set<string>();
  for (const field of fields) {
    if (!/^[A-Za-z0-9_-]+$/.test(field.key)) throw new Error(`Bad config key: ${field.key}`);
    if (keys.has(field.key)) throw new Error(`Config key used twice: ${field.key}`);
    keys.add(field.key);
    if (field.type === 'select' && !field.options?.length)
      throw new Error(`The select field ${field.key} needs options`);
    if (field.type === 'password' && !secret)
      throw new Error(`The password field ${field.key} needs configure.secret to encrypt it`);
  }
}

/** Reads a submitted form into a config, or says what is missing. */
export function readForm(
  fields: ConfigField[],
  form: { get(name: string): unknown },
): { config: Config } | { error: string } {
  const config: Config = {};
  for (const field of fields) {
    const raw = form.get(field.key);
    if (field.type === 'checkbox') {
      config[field.key] = raw !== null && raw !== undefined;
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') {
      if (field.required) return { error: `${field.label} is required.` };
      continue;
    }
    if (field.type === 'select' && !field.options?.includes(value))
      return { error: `Pick one of the choices for ${field.label}.` };
    if (value.length > 2000) return { error: `${field.label} is too long.` };
    config[field.key] = value;
  }
  return { config };
}

/** The app's own return address, which every add-on accepts. */
export const APP_RETURN = 'lelap://addon';

/**
 * Whether the configure page may send the manifest URL to `target`: the app's `lelap://addon`, or
 * `https://<origin>/addon` for an origin the add-on lists (a web build of the app). Anything else
 * could hand the listener's settings to a stranger.
 */
export function allowedReturn(target: string, origins: readonly string[] = []): boolean {
  if (/^lelap:\/\/addon\/?$/i.test(target)) return true;
  const match = /^(https:\/\/[a-z0-9.-]+(?::\d+)?)\/addon\/?$/i.exec(target);
  if (!match?.[1]) return false;
  const origin = match[1].toLowerCase();
  return origins.some((o) => o.replace(/\/+$/, '').toLowerCase() === origin);
}

/** Where the configure page sends the listener once the manifest URL is ready. */
export function returnUrl(target: string, manifestUrl: string): string {
  return `${target.replace(/\/+$/, '')}?manifest=${encodeURIComponent(manifestUrl)}`;
}

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;background:#14130f;color:#f3efe6;margin:0;padding:24px;max-width:32rem}
h1{font-size:1.5rem;margin:0 0 4px}p{color:#bdb8ad}label{display:block;margin:16px 0 4px}
input[type=text],input[type=password],select,textarea{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #3a3730;background:#1f1d18;color:inherit;font:inherit}
.check label{display:inline;margin-left:8px}.help{font-size:.85rem;color:#8d8a83;margin:4px 0 0}
button,.button{display:inline-block;margin-top:24px;padding:10px 20px;border:0;border-radius:999px;background:#e8a33c;color:#1a1305;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.error{color:#ff8a80}textarea{height:6rem;font-family:monospace;font-size:.85rem}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** The configure form, filled with `values` (never with passwords). */
export function configurePage(args: {
  name: string;
  description: string;
  fields: ConfigField[];
  values?: Config;
  error?: string;
  returnTo?: string;
}): string {
  const { name, description, fields, values = {}, error, returnTo } = args;
  const inputs = fields
    .map((field) => {
      const id = `f-${field.key}`;
      const help = field.help ? `<p class="help">${escape(field.help)}</p>` : '';
      const required = field.required ? ' required' : '';
      const current = values[field.key] ?? field.default;
      if (field.type === 'checkbox') {
        const checked = current === true ? ' checked' : '';
        return `<div class="check"><input type="checkbox" id="${id}" name="${escape(field.key)}"${checked}><label for="${id}">${escape(field.label)}</label>${help}</div>`;
      }
      if (field.type === 'select') {
        const options = (field.options ?? [])
          .map(
            (o) =>
              `<option${o === current ? ' selected' : ''} value="${escape(o)}">${escape(o)}</option>`,
          )
          .join('');
        return `<label for="${id}">${escape(field.label)}</label><select id="${id}" name="${escape(field.key)}"${required}>${options}</select>${help}`;
      }
      const value =
        field.type === 'password' || typeof current !== 'string'
          ? ''
          : ` value="${escape(current)}"`;
      const auto = field.type === 'password' ? ' autocomplete="current-password"' : '';
      return `<label for="${id}">${escape(field.label)}</label><input type="${field.type}" id="${id}" name="${escape(field.key)}"${value}${required}${auto}>${help}`;
    })
    .join('');
  const back = returnTo ? `<input type="hidden" name="return" value="${escape(returnTo)}">` : '';
  const problem = error ? `<p class="error" role="alert">${escape(error)}</p>` : '';
  return page(
    `${name} settings`,
    `<h1>${escape(name)}</h1><p>${escape(description)}</p>${problem}<form method="post">${inputs}${back}<button type="submit">Save</button></form>`,
  );
}

/** The page after saving: a button back to the app and the manifest URL to paste. */
export function configuredPage(args: {
  name: string;
  manifestUrl: string;
  returnTo?: string;
}): string {
  const { name, manifestUrl, returnTo } = args;
  const open = returnUrl(returnTo ?? APP_RETURN, manifestUrl);
  return page(
    `${name} is ready`,
    `<h1>${escape(name)} is ready</h1><p>Open it in Lelap, or copy this address and paste it under Settings → Add-ons.</p><textarea readonly aria-label="Manifest URL">${escape(manifestUrl)}</textarea><a class="button" href="${escape(open)}">Open in Lelap</a>`,
  );
}

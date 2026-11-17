import { utf8ToBytes } from '@noble/hashes/utils.js';

/** fetch, injected: the app passes the platform's, tests pass a fake. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding; not every runtime has `btoa` for UTF-8. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export const basicAuth = (username: string, password: string) =>
  `Basic ${toBase64(utf8ToBytes(`${username}:${password}`))}`;

export class RemoteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function failure(status: number, what: string): RemoteError {
  if (status === 401 || status === 403) {
    return new RemoteError(status, `The ${what} refused the login (HTTP ${status}).`);
  }
  return new RemoteError(status, `The ${what} answered HTTP ${status}.`);
}

// A library's Digest login (revision 13) travels with its other headers, sealed, under a header
// name the native code takes out and answers with HTTP Digest per request: Calibre's content
// server checks each request's `uri`, so one fixed header can't play several files. Code that
// sends headers itself, such as `fetch`, drops it: a browser or Expo can't answer Digest.

import { utf8ToBytes } from '@noble/hashes/utils.js';

import { toBase64 } from './http';

export const DIGEST_LOGIN_HEADER = 'X-Lelap-Digest';

const base64 = (text: string) => toBase64(utf8ToBytes(text));

/** The header value for a Digest login: the user name and password, each in base64. */
export function digestLoginValue(login: { username: string; password: string }): string {
  return `${base64(login.username)}:${base64(login.password)}`;
}

/** Whether `headers` carry a Digest login. */
export function hasDigestLogin(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'x-lelap-digest');
}

/** The headers without a Digest login, for code that can't answer one. */
export function withoutDigestLogin(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'x-lelap-digest'),
  );
}

/** A library's headers with its Digest login (revision 13) among them. */
export function libraryHeaders(response: {
  headers?: Record<string, string> | undefined;
  digest?: { username: string; password: string } | undefined;
}): Record<string, string> {
  const headers = { ...(response.headers ?? {}) };
  if (response.digest) headers[DIGEST_LOGIN_HEADER] = digestLoginValue(response.digest);
  return headers;
}

import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { Refused } from '../../../services/proxy/src/app';

/**
 * Loopback, private, link-local (cloud metadata), shared, multicast and reserved ranges. A
 * self-hosted proxy sits next to other services; it must not fetch them for strangers.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for addresses a public feed or cover never lives at (IPv4-mapped IPv6 included). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return blocked.check(address, 'ipv4');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(address, 'ipv6');
}

type Lookup = typeof dnsLookup;

const refused = () => new Refused(403, 'That address is on a private network.');

/** `dns.lookup` that fails when any address the name resolves to is private. */
export function guardedLookup(resolve: Lookup = dnsLookup) {
  return (
    hostname: string,
    options: LookupOptions,
    callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '');
      const list = addresses as LookupAddress[];
      const first = list[0];
      if (!first || list.some((a) => isPrivateAddress(a.address))) return callback(refused(), '');
      if (options.all) callback(null, list);
      else callback(null, first.address, first.family);
    });
  };
}

function decoded(response: IncomingMessage): Readable {
  switch (response.headers['content-encoding']?.toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

export type GuardOptions = { allowPrivate?: boolean; resolve?: Lookup };

/**
 * The proxy's `fetch` on Node. The address check runs when the socket connects, after DNS, so a
 * name that resolves to a private address (or is changed to one between checks) is refused.
 * Redirects are not followed here; the proxy app follows them and calls this for each hop.
 */
export function guardedFetch({ allowPrivate = false, resolve }: GuardOptions = {}) {
  const lookup = allowPrivate ? undefined : guardedLookup(resolve);
  return (url: string, init: RequestInit): Promise<Response> =>
    new Promise((done, fail) => {
      const target = new URL(url);
      const host = target.hostname.replace(/^\[|\]$/g, '');
      // Node skips the lookup for literal addresses, so check those here.
      if (!allowPrivate && isIP(host) && isPrivateAddress(host)) return fail(refused());
      const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        {
          method: init.method ?? 'GET',
          headers: { ...(init.headers as Record<string, string>), 'Accept-Encoding': 'gzip, br' },
          signal: init.signal ?? undefined,
          ...(lookup ? { lookup } : {}),
        },
        (response) => {
          const headers = new Headers();
          const encoded = Boolean(response.headers['content-encoding']);
          for (const [name, value] of Object.entries(response.headers)) {
            // The body is decoded below, so its encoding and length no longer apply.
            if (encoded && (name === 'content-encoding' || name === 'content-length')) continue;
            for (const v of Array.isArray(value) ? value : [value ?? '']) headers.append(name, v);
          }
          const status = response.statusCode ?? 502;
          const empty = status === 204 || status === 304 || (status >= 300 && status < 400);
          const body = empty ? null : (Readable.toWeb(decoded(response)) as ReadableStream);
          if (empty) response.resume();
          done(new Response(body, { status, headers }));
        },
      );
      request.on('error', fail);
      request.end(typeof init.body === 'string' ? init.body : undefined);
    });
}

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { ListedFile } from '../library/scan';
import { asArray, isNode, parseXml, textOf } from '../podcasts/xml';
import { failure, type Fetch } from './http';

export type S3Source = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Pre-signed links live this long (S3's maximum): playback re-signs on every load. */
export const PRESIGN_SECONDS = 7 * 24 * 60 * 60;
const EMPTY_HASH = bytesToHex(sha256(new Uint8Array()));

const encode = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodePath = (key: string) => key.split('/').map(encode).join('/');

/** `20130524T000000Z` and `20130524`. */
function stamps(now: number): { amzDate: string; day: string } {
  const amzDate = new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  return { amzDate, day: amzDate.slice(0, 8) };
}

/**
 * Where an object lives: virtual-hosted on AWS (`bucket.s3.region.amazonaws.com/key`), path style
 * elsewhere (`endpoint/bucket/key`; MinIO, Cloudflare R2, Backblaze, Wasabi, Garage).
 */
export function objectUrl(source: S3Source, key: string): URL {
  const endpoint = new URL(source.endpoint.trim().replace(/\/$/, ''));
  if (endpoint.hostname.endsWith('amazonaws.com')) {
    return new URL(`${endpoint.protocol}//${source.bucket}.${endpoint.host}/${encodePath(key)}`);
  }
  const base = endpoint.pathname.replace(/\/$/, '');
  return new URL(`${endpoint.origin}${base}/${encode(source.bucket)}/${encodePath(key)}`);
}

function signingKey(secret: string, day: string, region: string): Uint8Array {
  const step = (key: Uint8Array, data: string) => hmac(sha256, key, utf8ToBytes(data));
  return step(step(step(step(utf8ToBytes(`AWS4${secret}`), day), region), 's3'), 'aws4_request');
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k] ?? '')}`)
    .join('&');
}

function sign(
  source: S3Source,
  url: URL,
  query: Record<string, string>,
  headers: Record<string, string>,
  payloadHash: string,
  amzDate: string,
  day: string,
): string {
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
  );
  const canonical = [
    'GET',
    url.pathname,
    canonicalQuery(query),
    names.map((n) => `${n}:${lower[n] ?? ''}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${source.region}/s3/aws4_request`;
  const toSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    bytesToHex(sha256(utf8ToBytes(canonical))),
  ].join('\n');
  return bytesToHex(
    hmac(sha256, signingKey(source.secretAccessKey, day, source.region), utf8ToBytes(toSign)),
  );
}

/** A link that plays or downloads one object without any header, for [seconds]. */
export function presignGet(
  source: S3Source,
  key: string,
  now: number,
  seconds = PRESIGN_SECONDS,
): string {
  const url = objectUrl(source, key);
  const { amzDate, day } = stamps(now);
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${source.accessKeyId}/${day}/${source.region}/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(seconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const signature = sign(source, url, query, { host: url.host }, 'UNSIGNED-PAYLOAD', amzDate, day);
  return `${url.origin}${url.pathname}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

/** The object behind a stored `s3://bucket/key` file URI. */
export function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(uri);
  return m?.[1] && m[2] ? { bucket: m[1], key: m[2] } : null;
}

/** Every object below the prefix, as library files (`s3://bucket/key`, signed when played). */
export async function listS3(fetcher: Fetch, source: S3Source, now: number): Promise<ListedFile[]> {
  const prefix = source.prefix.replace(/^\/+/, '');
  const files: ListedFile[] = [];
  let token: string | undefined;
  do {
    const url = objectUrl(source, '');
    const query: Record<string, string> = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const { amzDate, day } = stamps(now);
    const headers = { host: url.host, 'x-amz-content-sha256': EMPTY_HASH, 'x-amz-date': amzDate };
    const signature = sign(source, url, query, headers, EMPTY_HASH, amzDate, day);
    const scope = `${day}/${source.region}/s3/aws4_request`;
    const response = await fetcher(`${url.origin}${url.pathname}?${canonicalQuery(query)}`, {
      headers: {
        'x-amz-content-sha256': EMPTY_HASH,
        'x-amz-date': amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${source.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      },
    });
    if (!response.ok) throw failure(response.status, 'S3 bucket');
    const doc = await parseXml(await response.text());
    const result = asArray(doc.ListBucketResult).find(isNode);
    for (const item of asArray(result?.Contents).filter(isNode)) {
      const key = textOf(item.Key);
      if (!key || key.endsWith('/')) continue;
      const relPath = key.slice(prefix.length).replace(/^\/+/, '');
      const modified = Date.parse(textOf(item.LastModified));
      files.push({
        location: `s3:${source.bucket}/${key}`,
        relPath,
        name: relPath.split('/').pop() ?? relPath,
        size: Number(textOf(item.Size)) || 0,
        modifiedAt: Number.isFinite(modified) ? modified : 0,
        uri: `s3://${source.bucket}/${key}`,
      });
    }
    token =
      textOf(result?.IsTruncated) === 'true'
        ? textOf(result?.NextContinuationToken) || undefined
        : undefined;
  } while (token);
  return files;
}

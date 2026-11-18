import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import { basicAuth } from '../src/remote/http';
import { objectUrl, type S3Source } from '../src/remote/s3';
import type { WebdavSource } from '../src/remote/webdav';

// The servers scripts/test-servers.sh starts; CI starts them with the same script. Test logins,
// not secrets: the containers live for one run and listen on localhost only.
const env = (name: string, fallback: string) => process.env[name] || fallback;

/** Each run seeds its own folder, so a second run against the same containers starts clean. */
export const RUN = `run-${Date.now().toString(36)}`;

export const webdav: WebdavSource = {
  url: new URL(`${RUN}/`, env('LELAP_TEST_WEBDAV_URL', 'http://127.0.0.1:18081/')).href,
  username: 'lelap-test',
  password: 'webdav-test-password',
};

export const s3: S3Source = {
  endpoint: env('LELAP_TEST_S3_URL', 'http://127.0.0.1:19190'),
  region: 'us-east-1',
  bucket: 'lelap-test',
  prefix: `${RUN}/library/`,
  accessKeyId: 'lelap-test',
  secretAccessKey: 's3-test-password',
};

/** Fails with a hint instead of a bare connection error when the servers aren't running. */
export async function reachable(url: string): Promise<void> {
  try {
    await fetch(url, { method: 'OPTIONS' });
  } catch {
    throw new Error(`No server at ${url}. Start them with scripts/test-servers.sh up.`);
  }
}

async function expectOk(response: Response, what: string): Promise<void> {
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${await response.text()}`);
}

/** Makes the run's WebDAV folder and uploads [files] below it, making each folder first. */
export async function seedWebdav(files: Map<string, Uint8Array>): Promise<void> {
  const auth = { Authorization: basicAuth(webdav.username, webdav.password) };
  const url = (path: string) =>
    new URL(path.split('/').map(encodeURIComponent).join('/'), webdav.url);
  const folders = new Set<string>();
  for (const path of files.keys()) {
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) folders.add(`${parts.slice(0, i).join('/')}/`);
  }
  await expectOk(await fetch(webdav.url, { method: 'MKCOL', headers: auth }), 'MKCOL run folder');
  for (const folder of [...folders].sort((a, b) => a.length - b.length)) {
    await expectOk(await fetch(url(folder), { method: 'MKCOL', headers: auth }), `MKCOL ${folder}`);
  }
  for (const [path, body] of files) {
    await expectOk(await fetch(url(path), { method: 'PUT', headers: auth, body }), `PUT ${path}`);
  }
}

const encode = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** A header-signed S3 request (SigV4); the app itself only lists and pre-signs reads. */
async function s3Request(method: string, key: string, body?: Uint8Array): Promise<Response> {
  const url = objectUrl(s3, key);
  const amzDate = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = bytesToHex(sha256(body ?? new Uint8Array()));
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const path = url.pathname
    .split('/')
    .map((part) => encode(decodeURIComponent(part)))
    .join('/');
  const canonical = [
    method,
    path,
    '',
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${s3.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, bytesToHex(sha256(utf8ToBytes(canonical)))];
  const step = (k: Uint8Array, data: string) => hmac(sha256, k, utf8ToBytes(data));
  const signingKey = step(
    step(step(step(utf8ToBytes(`AWS4${s3.secretAccessKey}`), day), s3.region), 's3'),
    'aws4_request',
  );
  const signature = bytesToHex(hmac(sha256, signingKey, utf8ToBytes(toSign.join('\n'))));
  // fetch sets Host itself.
  return fetch(url, {
    method,
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    ...(body ? { body } : {}),
  });
}

/** Makes the bucket (if needed) and uploads [files], each key under the run's [folder]. */
export async function seedS3(files: Map<string, Uint8Array>, folder: string): Promise<void> {
  const bucket = await s3Request('PUT', '');
  // 409: the bucket is there already, from an earlier run against the same container.
  if (bucket.status !== 409) await expectOk(bucket, 'PUT bucket');
  const entries = [...files];
  // A few uploads at a time: quick for a thousand small objects, gentle on the server.
  for (let i = 0; i < entries.length; i += 25) {
    await Promise.all(
      entries.slice(i, i + 25).map(async ([path, body]) => {
        await expectOk(await s3Request('PUT', `${RUN}/${folder}${path}`, body), `PUT ${path}`);
      }),
    );
  }
}

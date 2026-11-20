import { withoutDigestLogin } from '@lelap/core';

import * as opfs from './platform/opfs';

// The web app's covers folder (M67): server folder covers (WebDAV, S3, Subsonic, Plex) need the
// server's login, which an <img> can't send, so they are fetched once into the origin private
// file system and shown from there as blob URLs.

const COVERS = '/covers';
const MAX_BYTES = 10 * 1024 * 1024;
/** Marks a cover kept in OPFS where a component expects an image address. */
export const OPFS_SCHEME = 'opfs:';

/** Fetches a cover into the covers folder, once per version of the image; returns its path. */
export async function saveWebCover(
  uri: string,
  headers: Record<string, string>,
  name: string,
): Promise<string> {
  const path = `${COVERS}/${name}`;
  if (await opfs.exists(path)) return path;
  // A browser can't answer a Digest login (M135); it stays out of the request.
  const response = await fetch(uri, { headers: withoutDigestLogin(headers) });
  if (!response.ok) throw new Error(`The cover answered HTTP ${response.status}.`);
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > MAX_BYTES) throw new Error('The cover is empty or too big.');
  // createWritable swaps the file in on close, so a broken download never stays under the name.
  const writable = await (await opfs.fileHandle(path, true)).createWritable();
  await writable.write(blob);
  await writable.close();
  return path;
}

const urls = new Map<string, Promise<string | null>>();

/** A blob URL for a cover kept in OPFS, made once per path; null when the file is gone. */
export function opfsImageUrl(path: string): Promise<string | null> {
  let url = urls.get(path);
  if (!url) {
    url = opfs.readFile(path).then(
      (file) => URL.createObjectURL(file),
      () => null,
    );
    urls.set(path, url);
  }
  return url;
}

import {
  audiobookshelfStream,
  jellyfinStream,
  listRoots,
  parseS3Uri,
  presignGet,
  type RemoteSource,
  webdavHeaders,
} from '@lelap/core';
import { Platform } from 'react-native';

import { audiobookshelfBearer } from './audiobookshelf';
import { db } from './db';

/** Where a file plays from and what to send with it. */
export type FileAccess = { uri: string; headers: Record<string, string> };

function remoteOf(rootId: string | null): RemoteSource | null {
  if (!rootId) return null;
  return listRoots(db).find((r) => r.id === rootId)?.remote ?? null;
}

/**
 * A file's playable address: a WebDAV file with its login as a header, an S3 object as a fresh
 * pre-signed link, a Jellyfin item with its token (a header on the phone; in the address in a
 * browser, whose audio element can't send headers), an Audiobookshelf track the same way with its
 * current access token, anything else as stored.
 */
export function fileAccess(
  file: { uri: string; rootId: string | null },
  now = Date.now(),
): FileAccess {
  const remote = remoteOf(file.rootId);
  if (remote?.type === 'webdav') return { uri: file.uri, headers: webdavHeaders(remote) };
  if (remote?.type === 'jellyfin') return jellyfinStream(remote, file.uri, Platform.OS !== 'web');
  if (remote?.type === 'audiobookshelf' && file.rootId) {
    const bearer = audiobookshelfBearer(file.rootId, remote);
    return audiobookshelfStream(bearer, file.uri, Platform.OS !== 'web');
  }
  if (remote?.type === 's3') {
    const object = parseS3Uri(file.uri);
    if (object) return { uri: presignGet(remote, object.key, now), headers: {} };
  }
  return { uri: file.uri, headers: {} };
}

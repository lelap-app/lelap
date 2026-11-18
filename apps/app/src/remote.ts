import {
  addonFileAccess,
  addonLogin,
  addonSourceHosts,
  audiobookshelfStream,
  jellyfinStream,
  listRoots,
  parseS3Uri,
  presignGet,
  type RemoteSource,
  sameAddonCode,
  streamHeadersFor,
  webdavHeaders,
} from '@lelap/core';
import { Platform } from 'react-native';

import { codeFingerprint, declaredHosts, sourceManifest } from './addonSources';
import { db } from './db';

/**
 * Where a file plays from and what to send with it. `private`: the address itself carries a login,
 * so it goes nowhere but its server (a cast receiver gets the file through the phone).
 */
export type FileAccess = { uri: string; headers: Record<string, string>; private?: boolean };

function remoteOf(rootId: string | null): RemoteSource | null {
  if (!rootId) return null;
  return listRoots(db).find((r) => r.id === rootId)?.remote ?? null;
}

/**
 * A file's playable address: a WebDAV file with its login as a header, an S3 object as a fresh
 * pre-signed link, a Jellyfin item with its token (a header on the phone; in the address in a
 * browser, whose audio element can't send headers), an Audiobookshelf track the same way with its
 * API key, a file from an add-on inside the app with the headers and query parameters it asked
 * for (only on its own hosts), anything else as stored.
 */
export function fileAccess(
  file: { uri: string; rootId: string | null; bookId?: string | null },
  now = Date.now(),
): FileAccess {
  const remote = remoteOf(file.rootId);
  if (remote?.type === 'addon') {
    // Another file under the add-on's ID gets none of the login entered for the old one.
    const trusted = sameAddonCode(remote, codeFingerprint(remote.addonUrl));
    const manifest = trusted ? sourceManifest(remote.addonUrl) : null;
    const hosts = manifest ? addonSourceHosts(manifest, remote.settings) : [];
    // The stored address never has the login in it; it is added here, as late as possible.
    return addonFileAccess(file.uri, addonLogin(remote), hosts, Platform.OS !== 'web');
  }
  if (!remote && file.bookId) {
    return { uri: file.uri, headers: streamHeadersFor(db, file.bookId, file.uri, declaredHosts) };
  }
  if (remote?.type === 'webdav') return { uri: file.uri, headers: webdavHeaders(remote) };
  if (remote?.type === 'jellyfin') return jellyfinStream(remote, file.uri, Platform.OS !== 'web');
  if (remote?.type === 'audiobookshelf') {
    return audiobookshelfStream(remote.token, file.uri, Platform.OS !== 'web');
  }
  if (remote?.type === 's3') {
    const object = parseS3Uri(file.uri);
    if (object) return { uri: presignGet(remote, object.key, now), headers: {} };
  }
  return { uri: file.uri, headers: {} };
}

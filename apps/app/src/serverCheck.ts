import {
  audiobookshelfMe,
  listRoots,
  netfsHeaders,
  netRootUri,
  setNetServerRefused,
} from '@lelap/core';

import { atServer, probeAfterError } from './addresses';
import { withKey } from './audiobookshelf';
import { db } from './db';
import type { PlayerState } from './platform/audio';
import { check, NETFS_ERRORS } from './platform/netfs';

// A book on a server that can't play shows the player's usual error. When the server refused the
// login or changed its key, Settings says so at once (M62), not only after the next scan: the
// error makes the app ask the server once.

let lastError: string | null = null;

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;

/** Feeds a player state; `onMarked` runs when a server's state in Settings changed. */
export function checkServerAfterError(state: PlayerState, onMarked: () => void): void {
  const error = state.connected ? state.error : null;
  if (error === lastError) return;
  lastError = error;
  const location = state.fileLocation;
  if (!error || !location) return;
  const root = listRoots(db).find((r) => r.remote && location.startsWith(`${r.location}/`));
  const remote = root?.remote;
  if (!root || !remote || root.needsLogin) return;
  probeAfterError(root.id);
  if (remote.type === 'smb' || remote.type === 'sftp') {
    check(netRootUri(remote), netfsHeaders(remote))
      .then(() => setNetServerRefused(db, root.id, null, Date.now()))
      .catch((failure: unknown) => {
        const code = codeOf(failure);
        if (code === NETFS_ERRORS.login) setNetServerRefused(db, root.id, 'login', Date.now());
        if (code === NETFS_ERRORS.hostKeyChanged) {
          setNetServerRefused(db, root.id, 'host-key', Date.now());
        }
      })
      .finally(onMarked);
  } else if (remote.type === 'audiobookshelf') {
    // `withKey` marks a refused key, and clears the mark when the key works.
    void withKey(
      root.id,
      atServer(root.id, remote, (at) => audiobookshelfMe((u, i) => fetch(u, i), at.url, at.token)),
    )
      .catch(() => {})
      .finally(onMarked);
  }
}

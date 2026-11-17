import type { Db } from './db';
import { sealRemoteRoots } from './library/scan';
import { sealMembership } from './sync/engine';

/**
 * Run once at start, after migrations and `setSecretBox`: seals secrets stored in plain text by
 * earlier versions, and notices secrets this device can no longer open.
 */
export function sealStoredSecrets(db: Db, now: number): void {
  sealMembership(db, now);
  sealRemoteRoots(db, now);
}

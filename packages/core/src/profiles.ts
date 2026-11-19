import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { asc, eq } from 'drizzle-orm';

import type { Db } from './db';
import type { IdGenerator } from './ids';
import {
  bookmarks,
  libraryEntries,
  profiles,
  progress,
  settings,
  subscriptions,
  syncState,
  tombstones,
  upNext,
  bookTags,
  hiddenBooks,
  ownChapters,
  playlists,
  listeningLog,
  playbackHistory,
  scrobbleOutbox,
} from './schema';
import { recordDeletion } from './sync/keys';

/** The profile every install starts with; it has the same ID on every device. */
export const DEFAULT_PROFILE_ID = '00000000-0000-7000-8000-000000000001';

/** @deprecated Use `getActiveProfile`; kept for code from before profiles. */
export function currentProfileId(): string {
  return DEFAULT_PROFILE_ID;
}

export type Profile = typeof profiles.$inferSelect;

export function listProfiles(db: Db): Profile[] {
  return db.select().from(profiles).orderBy(asc(profiles.createdAt)).all();
}

export function getProfile(db: Db, id: string): Profile | null {
  return db.select().from(profiles).where(eq(profiles.id, id)).get() ?? null;
}

const ACTIVE = 'activeProfile';

/** The profile this device last used; each device remembers its own. */
export function getActiveProfile(db: Db): string {
  const stored = db.select().from(syncState).where(eq(syncState.key, ACTIVE)).get()?.value;
  if (stored && getProfile(db, stored)) return stored;
  return listProfiles(db)[0]?.id ?? DEFAULT_PROFILE_ID;
}

export function setActiveProfile(db: Db, id: string, now: number): void {
  db.insert(syncState)
    .values({ key: ACTIVE, value: id, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.key, set: { value: id, updatedAt: now } })
    .run();
}

export function createProfile(
  db: Db,
  input: { name: string; avatar: string | null; kids: boolean; hiddenAddons?: string[] },
  now: number,
  newId: IdGenerator,
): string {
  const id = newId();
  db.insert(profiles)
    .values({
      id,
      name: input.name.trim() || 'Listener',
      avatar: input.avatar,
      kids: input.kids,
      hiddenAddons: input.hiddenAddons ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export function updateProfile(
  db: Db,
  id: string,
  set: Partial<Pick<Profile, 'name' | 'avatar' | 'kids' | 'hiddenAddons'>>,
  now: number,
): void {
  db.update(profiles)
    .set({
      ...set,
      ...(set.name !== undefined ? { name: set.name.trim() || 'Listener' } : {}),
      updatedAt: now,
    })
    .where(eq(profiles.id, id))
    .run();
}

/**
 * Deletes a profile with its places, bookmarks, settings, subscriptions and Up Next. The last
 * profile can't be deleted. Downloads and streamed books stay: they are shared.
 */
export function deleteProfile(db: Db, id: string, now: number): boolean {
  if (listProfiles(db).length <= 1) return false;
  db.transaction((tx) => {
    tx.delete(progress).where(eq(progress.profileId, id)).run();
    tx.delete(libraryEntries).where(eq(libraryEntries.profileId, id)).run();
    tx.delete(bookmarks).where(eq(bookmarks.profileId, id)).run();
    tx.delete(settings).where(eq(settings.profileId, id)).run();
    tx.delete(subscriptions).where(eq(subscriptions.profileId, id)).run();
    tx.delete(upNext).where(eq(upNext.profileId, id)).run();
    tx.delete(bookTags).where(eq(bookTags.profileId, id)).run();
    tx.delete(hiddenBooks).where(eq(hiddenBooks.profileId, id)).run();
    tx.delete(ownChapters).where(eq(ownChapters.profileId, id)).run();
    tx.delete(playlists).where(eq(playlists.profileId, id)).run();
    tx.delete(listeningLog).where(eq(listeningLog.profileId, id)).run();
    tx.delete(playbackHistory).where(eq(playbackHistory.profileId, id)).run();
    tx.delete(scrobbleOutbox).where(eq(scrobbleOutbox.profileId, id)).run();
    tx.delete(tombstones).where(eq(tombstones.profileId, id)).run();
    tx.delete(profiles).where(eq(profiles.id, id)).run();
    recordDeletion(tx, 'profile', id, null, now);
  });
  return true;
}

const PIN = /^\d{4}$/;

export const isPin = (pin: string) => PIN.test(pin);

/**
 * A PIN's hash, salted with the profile ID. Four digits are easy to try, so this only keeps
 * others from opening a profile on this device; it protects no data, and the app says so.
 */
export function hashPin(profileId: string, pin: string): string {
  return bytesToHex(sha256(utf8ToBytes(`lelap pin v1:${profileId}:${pin}`)));
}

/** Sets (four digits) or removes (null) a profile's PIN. */
export function setPin(db: Db, id: string, pin: string | null, now: number): void {
  if (pin !== null && !isPin(pin)) throw new Error('A PIN is four digits.');
  db.update(profiles)
    .set({ pinHash: pin === null ? null : hashPin(id, pin), updatedAt: now })
    .where(eq(profiles.id, id))
    .run();
}

export function checkPin(db: Db, id: string, pin: string): boolean {
  const profile = getProfile(db, id);
  if (!profile?.pinHash) return true;
  return profile.pinHash === hashPin(id, pin);
}

/** A small value only this device keeps, such as which profile the player's book belongs to. */
export function deviceValue(db: Db, key: string): string | null {
  return db.select().from(syncState).where(eq(syncState.key, key)).get()?.value ?? null;
}

export function setDeviceValue(db: Db, key: string, value: string, now: number): void {
  db.insert(syncState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: now } })
    .run();
}

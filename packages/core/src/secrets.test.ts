import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { addRemoteRoot, listRoots, updateRemoteRoot } from './library/scan';
import { libraryRoots, syncState } from './schema';
import { createSecretBox, isSealed, plainBox, setSecretBox } from './secrets';
import { sealStoredSecrets } from './storedSecrets';
import type { SyncClient } from './sync/client';
import { getMembership, removedFromSync, startSync } from './sync/engine';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${++n}`;

const server = {
  createGroup: async () => {},
} as unknown as SyncClient;

const storedMembership = (db: ReturnType<typeof createTestDb>) =>
  JSON.parse(
    db.select().from(syncState).where(eq(syncState.key, 'membership')).get()?.value ?? '{}',
  ) as { key: string };

const storedPassword = (db: ReturnType<typeof createTestDb>, id: string) => {
  const remote = db.select().from(libraryRoots).where(eq(libraryRoots.id, id)).get()?.remote;
  return remote?.type === 'webdav' ? remote.password : '';
};

const webdav = { type: 'webdav', url: 'https://dav.example/books', username: 'me' } as const;

afterEach(() => setSecretBox(plainBox));

describe('secret box', () => {
  it('seals and opens; plain values written before sealing pass through', () => {
    const box = createSecretBox(random(32), random);
    const sealed = box.seal('hunter2');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('hunter2');
    expect(box.open(sealed)).toBe('hunter2');
    expect(box.open('written in plain')).toBe('written in plain');
    expect(createSecretBox(random(32), random).open(sealed)).toBeNull();
    expect(plainBox.open(sealed)).toBeNull();
  });
});

describe('stored secrets', () => {
  it('seals a group key stored in plain text and still syncs with it', async () => {
    const db = createTestDb();
    const plain = await startSync(db, server, 'Phone', random, 1);
    expect(storedMembership(db).key).toBe(plain.key);

    setSecretBox(createSecretBox(random(32), random));
    sealStoredSecrets(db, 2);
    expect(isSealed(storedMembership(db).key)).toBe(true);
    expect(getMembership(db)?.key).toBe(plain.key);
  });

  it('asks to pair again when the key did not come back with a restored backup', async () => {
    const db = createTestDb();
    setSecretBox(createSecretBox(random(32), random));
    await startSync(db, server, 'Phone', random, 1);

    // A new phone: same database, a new key in its key store.
    setSecretBox(createSecretBox(random(32), random));
    expect(getMembership(db)).toBeNull();
    sealStoredSecrets(db, 5);
    expect(removedFromSync(db)).toEqual({ at: 5, reason: 'restore' });
    expect(db.select().from(syncState).where(eq(syncState.key, 'membership')).get()).toBeFalsy();
  });

  it('seals server passwords and asks for them again after a restore', () => {
    const db = createTestDb();
    const id = addRemoteRoot(db, { ...webdav, password: 'old plain' }, 1, newId);
    expect(storedPassword(db, id)).toBe('old plain');

    const phone = createSecretBox(random(32), random);
    setSecretBox(phone);
    sealStoredSecrets(db, 2);
    expect(isSealed(storedPassword(db, id))).toBe(true);
    const [root] = listRoots(db);
    expect(root?.remote).toMatchObject({ password: 'old plain' });
    expect(root?.needsLogin).toBe(false);

    setSecretBox(createSecretBox(random(32), random));
    const [restored] = listRoots(db);
    expect(restored?.needsLogin).toBe(true);
    expect(restored?.remote).toMatchObject({ password: '' });

    updateRemoteRoot(db, id, { ...webdav, password: 'new' }, 3);
    const [fixed] = listRoots(db);
    expect(fixed?.needsLogin).toBe(false);
    expect(fixed?.remote).toMatchObject({ password: 'new' });
    expect(isSealed(storedPassword(db, id))).toBe(true);
  });

  it('keeps values as they are where there is no key store (web)', async () => {
    const db = createTestDb();
    const id = addRemoteRoot(db, { ...webdav, password: 'pw' }, 1, newId);
    await startSync(db, server, 'Browser', random, 1);
    sealStoredSecrets(db, 2);
    expect(storedPassword(db, id)).toBe('pw');
    expect(getMembership(db)).not.toBeNull();
    expect(removedFromSync(db)).toBeNull();
  });
});

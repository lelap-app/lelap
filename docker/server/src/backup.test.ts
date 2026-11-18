import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { backupSync, RESTORE_SKIP, restoreSync, verifySync } from './backup';
import { secret } from './secrets';
import { migrate, sqliteStore } from './sqliteStore';
import { syncStatus } from './syncAdmin';

const migration = (name: string) =>
  readFileSync(new URL(`../../../services/sync/migrations/${name}`, import.meta.url), 'utf8');
const migrations = {
  '0001_init.sql': migration('0001_init.sql'),
  '0002_snapshots.sql': migration('0002_snapshots.sql'),
};

const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
});

async function database(file: string, groups: number) {
  const db = new DatabaseSync(file);
  open.push(db);
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, migrations);
  const store = sqliteStore(db);
  for (let i = 0; i < groups; i++) {
    const id = i.toString(16).padStart(32, '0');
    await store.createGroup(id, 'f'.repeat(64), 1_700_000_000_000);
    await store.append(id, 'd'.repeat(32), ['x'.repeat(100 * (i + 1))], 1_700_000_000_000);
  }
  return db;
}

describe('sync backups', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'm95-sync-'));

  it('backs up while the server writes, and restores the copy', async () => {
    const root = dir();
    const file = join(root, 'sync.db');
    const db = await database(file, 3);
    const copy = await backupSync(file, undefined, new Date('2026-11-18T10:00:00Z'));
    expect(copy).toBe(join(root, 'backups', 'sync-2026-11-18T10-00-00.db'));
    await expect(backupSync(file, copy)).rejects.toThrow('exists');
    expect(verifySync(copy)).toEqual({ groups: 3 });
    // Verified where it can't write, as in a read-only mount.
    chmodSync(join(root, 'backups'), 0o555);
    expect(verifySync(copy)).toEqual({ groups: 3 });
    chmodSync(join(root, 'backups'), 0o755);

    // Changes after the backup are what a restore gives up.
    await sqliteStore(db).createGroup('e'.repeat(32), 'f'.repeat(64), 1);
    expect(() => restoreSync(file, copy)).toThrow('Stop sync first');
    db.close();
    expect(restoreSync(file, copy, new Date('2026-11-18T11:00:00Z'))).toEqual({ groups: 3 });
    expect(existsSync(`${file}.replaced-2026-11-18T11-00-00`)).toBe(true);
    expect(existsSync(`${file}-wal`)).toBe(false);
    const restored = new DatabaseSync(file);
    open.push(restored);
    expect(restored.prepare('SELECT COUNT(*) AS n FROM groups').get()).toEqual({ n: 3 });
    // New messages are numbered past anything a device read before the restore.
    await sqliteStore(restored).append('0'.repeat(32), 'd'.repeat(32), ['new'], 2);
    const { seq } = restored.prepare('SELECT MAX(seq) AS seq FROM messages').get() as {
      seq: number;
    };
    expect(seq).toBe(RESTORE_SKIP + 4);
  });

  it('refuses files that are not a sync database', () => {
    const root = dir();
    const other = join(root, 'other.db');
    new DatabaseSync(other).exec('CREATE TABLE notes (text TEXT)');
    expect(() => verifySync(other)).toThrow('not a sync database');
    const junk = join(root, 'junk.db');
    writeFileSync(junk, 'not sqlite at all, just some text that is long enough');
    expect(() => verifySync(junk)).toThrow();
    expect(() => restoreSync(join(root, 'sync.db'), junk)).toThrow();
    expect(existsSync(join(root, 'sync.db'))).toBe(false);
    expect(() => verifySync(join(root, 'missing.db'))).toThrow('does not exist');
  });
});

describe('sync status', () => {
  it('counts groups and shows them by size, with shortened IDs', async () => {
    const db = await database(':memory:', 3);
    const status = syncStatus(db, '730');
    expect(status.settings).toContainEqual(['Groups', '3']);
    expect(status.settings).toContainEqual(['Idle groups expire', 'after 730 days']);
    const rows = status.tables?.[0]?.rows ?? [];
    expect(rows.map((r) => r[0])).toEqual(['00000000…', '00000000…', '00000000…']);
    expect(rows[0]?.[1]).toBe('300 B');
    expect(rows[0]?.[4]).toBe('2023-11-14');
    expect(JSON.stringify(status)).not.toContain('x'.repeat(100));
    expect(JSON.stringify(status)).not.toContain('f'.repeat(64));
    expect(syncStatus(db, '').settings).toContainEqual(['Idle groups expire', 'never']);
  });
});

describe('generated secrets', () => {
  it('prefers the environment, else makes one once and keeps it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm95-secrets-'));
    expect(secret('ADMIN_TOKEN', { ADMIN_TOKEN: ' given ' }, dir)).toBe('given');
    expect(existsSync(join(dir, 'admin_token'))).toBe(false);
    const made = secret('ADMIN_TOKEN', {}, dir);
    expect(made).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secret('ADMIN_TOKEN', { ADMIN_TOKEN: '' }, dir)).toBe(made);
    expect(statSync(join(dir, 'admin_token')).mode & 0o777).toBe(0o600);
    expect(secret('CONFIG_SECRET', {}, dir)).not.toBe(made);
    expect(secret('ADMIN_TOKEN', {}, undefined)).toBeUndefined();
  });
});

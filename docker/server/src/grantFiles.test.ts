import { mkdtempSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GRANT_LIFETIME_MS } from '../../../services/catalog/src/scrobble/hardcover-grants';
import { grantFiles } from './grantFiles';

const ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'BBBBBBBBBBBBBBBBBBBBBB';

describe('Hardcover grant files', () => {
  it('keeps, replaces and drops a sealed record, readable by its owner only', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'm92-grants-')), 'grants');
    const store = grantFiles(dir);
    expect(await store.get(ID)).toBe(null);
    await store.put(ID, 'sealed-1');
    await store.put(ID, 'sealed-2');
    expect(await store.get(ID)).toBe('sealed-2');
    expect(statSync(join(dir, `${ID}.grant`)).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([`${ID}.grant`]);
    await store.delete(ID);
    expect(await store.get(ID)).toBe(null);
  });

  it('refuses an ID that could leave the folder', async () => {
    const store = grantFiles(mkdtempSync(join(tmpdir(), 'm92-grants-')));
    await expect(store.get('../../etc/passwd')).rejects.toThrow('Bad grant ID');
  });

  it('drops grants unused for longer than a refresh token lasts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'm92-grants-'));
    const now = Date.now();
    await grantFiles(dir, () => now - 1).put(OTHER, 'old');
    const old = (now - GRANT_LIFETIME_MS - 1000) / 1000;
    utimesSync(join(dir, `${OTHER}.grant`), old, old);
    await grantFiles(dir, () => now).put(ID, 'new');
    expect(readdirSync(dir)).toEqual([`${ID}.grant`]);
  });
});

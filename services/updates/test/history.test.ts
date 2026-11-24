import { describe, expect, it } from 'vitest';

import {
  type History,
  isUpdateFile,
  parseHistory,
  pickRemovals,
  recordUpdate,
  type UpdateEntry,
  updateKey,
} from '../src/history';

const md5 = (n: number) => n.toString(16).padStart(32, '0');

function update(n: number, channels: string[], runtimeVersion = 'rt1'): UpdateEntry {
  const uid = `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
  return {
    runtimeVersion,
    id: uid,
    publishedAt: new Date(Date.UTC(2026, 0, n)).toISOString(),
    channels,
    files: [
      `ota/${runtimeVersion}/${uid}/${md5(n)}.bundle`,
      `ota/${runtimeVersion}/${uid}/${md5(1000 + n)}.png`,
    ],
  };
}

const history = (...updates: UpdateEntry[]): History => ({ updates });
const ids = (h: History) => h.updates.map((e) => e.id.slice(0, 8));

function at<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`No item ${index}`);
  return item;
}

describe('pickRemovals', () => {
  it('keeps the newest of each channel and removes the rest', () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((n) => update(n, ['beta']));
    const { history: kept, remove } = pickRemovals(history(...all), new Set(), 5);
    expect(ids(kept)).toEqual(['00000003', '00000004', '00000005', '00000006', '00000007']);
    expect(remove).toEqual([...at(all, 1).files, ...at(all, 0).files]);
  });

  it('never removes what a live record points at', () => {
    const all = [1, 2, 3].map((n) => update(n, ['production']));
    const { history: kept, remove } = pickRemovals(
      history(...all),
      new Set([updateKey(at(all, 0))]),
      1,
    );
    expect(ids(kept)).toEqual(['00000001', '00000003']);
    expect(remove).toEqual(at(all, 1).files);
  });

  it('keeps the newest of every channel and runtime, so an old APK keeps its last update', () => {
    const old = update(1, ['production'], 'rt-old');
    const newer = [2, 3, 4].map((n) => update(n, ['production'], 'rt-new'));
    const { history: kept } = pickRemovals(history(old, ...newer), new Set(), 1);
    expect(ids(kept)).toEqual(['00000001', '00000004']);
  });

  it('keeps an update that is recent on either of its channels', () => {
    const stable = update(1, ['production', 'beta']);
    const betas = [2, 3, 4].map((n) => update(n, ['beta']));
    const { history: kept } = pickRemovals(history(stable, ...betas), new Set(), 2);
    // Two newest betas, plus the stable one, the newest on production.
    expect(ids(kept)).toEqual(['00000001', '00000003', '00000004']);
  });

  it('removes only an update’s own files, never another kept update’s', () => {
    const shared = 'ota/rt1/00000002-0000-4000-8000-000000000000/' + md5(2) + '.bundle';
    const a = {
      ...update(1, ['beta']),
      files: [shared, 'ota/channels/beta/rt1.json', 'apk/lelap.apk'],
    };
    const b = update(2, ['beta']);
    const { remove } = pickRemovals(history(a, b), new Set(), 1);
    expect(remove).toEqual([]);
  });

  it('removes nothing with nothing listed', () => {
    expect(pickRemovals(history(), new Set())).toEqual({ history: history(), remove: [] });
  });
});

describe('isUpdateFile', () => {
  const entry = update(1, ['beta']);
  it('takes content-named files in the update’s folder only', () => {
    expect(isUpdateFile(entry, at(entry.files, 0))).toBe(true);
    expect(isUpdateFile(entry, `ota/rt1/${entry.id}/../channels/beta/rt1.json`)).toBe(false);
    expect(isUpdateFile(entry, `ota/rt1/${entry.id}/sub/${md5(1)}.png`)).toBe(false);
    expect(isUpdateFile(entry, `ota/rt1/${entry.id}/`)).toBe(false);
    expect(isUpdateFile({ ...entry, id: '../x' }, `ota/rt1/../x/${md5(1)}.png`)).toBe(false);
    expect(isUpdateFile({ ...entry, runtimeVersion: '' }, `ota//${entry.id}/${md5(1)}.png`)).toBe(
      false,
    );
  });
});

describe('recordUpdate', () => {
  it('joins the channels of the same update published again', () => {
    const beta = update(1, ['beta']);
    const stable = {
      ...beta,
      channels: ['production', 'beta'],
      publishedAt: '2026-02-01T00:00:00.000Z',
    };
    const h = recordUpdate(history(beta), stable);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]?.channels.sort()).toEqual(['beta', 'production']);
    expect(h.updates[0]?.publishedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('adds a new update at the end', () => {
    expect(ids(recordUpdate(history(update(1, ['beta'])), update(2, ['beta'])))).toEqual([
      '00000001',
      '00000002',
    ]);
  });
});

describe('parseHistory', () => {
  it('starts empty without a list, and refuses one it can’t read', () => {
    expect(parseHistory(null)).toEqual({ updates: [] });
    expect(parseHistory('')).toEqual({ updates: [] });
    expect(parseHistory('<html>')).toBeNull();
    expect(parseHistory('{"updates":{}}')).toBeNull();
    expect(parseHistory('{"updates":[{"id":"x"}]}')).toBeNull();
  });

  it('reads what it wrote', () => {
    const h = history(update(1, ['beta']), update(2, ['production', 'beta']));
    expect(parseHistory(JSON.stringify(h))).toEqual(h);
  });
});

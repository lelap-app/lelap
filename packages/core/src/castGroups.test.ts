import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { CAST_GROUPS_KEPT, castGroupsHere, forgetCastGroup, rememberCastGroup } from './castGroups';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { getSettings, setSetting } from './settings';

describe('rememberCastGroup', () => {
  it('puts the group first and keeps who led', () => {
    const once = rememberCastGroup([], ['sonos', 'nest']);
    const twice = rememberCastGroup(once, ['kitchen', 'nest']);
    expect(twice).toEqual([{ ids: ['kitchen', 'nest'] }, { ids: ['sonos', 'nest'] }]);
    // The same speakers again, led by the other one: one entry, at the front, in the new order.
    expect(rememberCastGroup(twice, ['nest', 'sonos'])).toEqual([
      { ids: ['nest', 'sonos'] },
      { ids: ['kitchen', 'nest'] },
    ]);
  });

  it('ignores a single speaker, also one named twice', () => {
    expect(rememberCastGroup([], ['nest'])).toEqual([]);
    expect(rememberCastGroup([], ['nest', 'nest'])).toEqual([]);
  });

  it('keeps only the newest', () => {
    let groups = rememberCastGroup([], ['a', 'b']);
    for (const id of ['c', 'd', 'e', 'f', 'g']) groups = rememberCastGroup(groups, ['a', id]);
    expect(groups).toHaveLength(CAST_GROUPS_KEPT);
    expect(groups[0]).toEqual({ ids: ['a', 'g'] });
    expect(groups.some((g) => g.ids.includes('b'))).toBe(false);
  });
});

describe('forgetCastGroup', () => {
  it('drops the group whatever the order', () => {
    const groups = rememberCastGroup(rememberCastGroup([], ['a', 'b']), ['a', 'c']);
    expect(forgetCastGroup(groups, ['b', 'a'])).toEqual([{ ids: ['a', 'c'] }]);
  });
});

describe('castGroupsHere', () => {
  const groups = [{ ids: ['a', 'b'] }, { ids: ['a', 'c'] }];

  it('offers only groups whose speakers are all found', () => {
    expect(castGroupsHere(groups, new Set(['a', 'b']), null)).toEqual([{ ids: ['a', 'b'] }]);
  });

  it('leaves out the group that plays', () => {
    expect(castGroupsHere(groups, new Set(['a', 'b', 'c']), ['b', 'a'])).toEqual([
      { ids: ['a', 'c'] },
    ]);
  });
});

describe('the castGroups setting', () => {
  it('keeps groups and refuses a group of one', () => {
    const db = createTestDb();
    setSetting(db, ME, 'castGroups', [{ ids: ['a', 'b'] }], 1);
    expect(getSettings(db, ME).castGroups).toEqual([{ ids: ['a', 'b'] }]);
    expect(() => setSetting(db, ME, 'castGroups', [{ ids: ['a'] }], 2)).toThrow();
  });
});

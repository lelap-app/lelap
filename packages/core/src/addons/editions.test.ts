import type { Meta } from '@lelap/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { getSettings } from '../settings';
import { chosenEdition, getEditionChoice, setEditionChoice, withEdition } from './editions';
import { workIds } from './sources';

const meta: Meta = {
  id: 'ol:OL1W',
  type: 'audiobook',
  name: 'Emma',
  year: 1815,
  durationMs: 1000,
  narrators: ['Juliet Stevenson'],
  chapters: [{ title: 'One', startMs: 0 }],
  externalIds: { ol: 'OL1W', asin: 'B000000001' },
  editions: [
    { key: 'OL2M', name: 'Naxos, 2007', year: 2007, externalIds: { asin: 'B000000001' } },
    {
      key: 'OL3M',
      name: 'Blackstone Audio, 2010',
      year: 2010,
      narrators: ['Kate Reading'],
      durationMs: 2000,
      cover: 'https://covers.example/3.jpg',
      externalIds: { asin: 'B000000003', isbn: '9781441709530' },
    },
  ],
};

describe('editions', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('keeps a profile’s choice apart from its settings, and forgets it', () => {
    expect(getEditionChoice(db, ME, 'audiobook', 'ol:OL1W')).toBe(null);
    setEditionChoice(db, ME, 'audiobook', 'ol:OL1W', 'OL3M', 1);
    expect(getEditionChoice(db, ME, 'audiobook', 'ol:OL1W')).toBe('OL3M');
    expect(getSettings(db, ME)).not.toHaveProperty('edition:audiobook:ol:OL1W');
    setEditionChoice(db, ME, 'audiobook', 'ol:OL1W', null, 2);
    expect(getEditionChoice(db, ME, 'audiobook', 'ol:OL1W')).toBe(null);
  });

  it('shows the chosen edition and asks add-ons by its IDs', () => {
    const edition = chosenEdition(meta, 'OL3M');
    const shown = withEdition(meta, edition);
    expect(shown.year).toBe(2010);
    expect(shown.narrators).toEqual(['Kate Reading']);
    expect(shown.cover).toBe('https://covers.example/3.jpg');
    // Another length: the work's chapters belong to another recording.
    expect(shown.chapters).toBeUndefined();
    expect(workIds(shown.id, shown.externalIds)).toEqual([
      'ol:OL1W',
      'asin:B000000003',
      'isbn:9781441709530',
    ]);
  });

  it('keeps the work as it is without a choice, or when the chosen edition is gone', () => {
    expect(withEdition(meta, chosenEdition(meta, null))).toBe(meta);
    expect(chosenEdition(meta, 'OL9M')).toBe(null);
    // The edition the meta describes keeps its narrators, length and chapters.
    const own = withEdition(meta, chosenEdition(meta, 'OL2M'));
    expect(own.chapters).toHaveLength(1);
    expect(own.narrators).toEqual(['Juliet Stevenson']);
    expect(own.durationMs).toBe(1000);
  });

  it('never gives another edition the meta’s narrators, length or ASIN', () => {
    const bare = { key: 'OL4M', name: 'Print', externalIds: { isbn: '9780141439587' } };
    const shown = withEdition({ ...meta, editions: [bare] }, bare);
    expect(shown.narrators).toBeUndefined();
    expect(shown.durationMs).toBeUndefined();
    expect(shown.chapters).toBeUndefined();
    expect(shown.externalIds).toEqual({ ol: 'OL1W', isbn: '9780141439587' });
  });
});

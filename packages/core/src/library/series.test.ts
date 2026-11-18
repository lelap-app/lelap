import type { Meta, Stream } from '@lelap/sdk';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import { addStreamedBook } from '../addons/streamed';
import type { Db } from '../db';
import { hideBooks } from './hidden';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { books, type KindTags } from '../schema';
import { applyOps, collectOps, type Op } from '../sync/ops';
import type { ScannedFile } from './files';
import { linkBook } from './links';
import { setFinished } from './queries';
import { applyScan, splitScanned, upsertRoot } from './scan';
import {
  applyOrder,
  compareInSeries,
  formatSeries,
  getSeries,
  getSeriesOrder,
  listSeries,
  missingNumbers,
  moveInSeries,
  nextInSeries,
  parseSeries,
  seriesKey,
  seriesNumber,
  setSeriesOrder,
} from './series';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const tags = (series: string | null): KindTags => ({
  genre: null,
  isrc: null,
  track: null,
  year: null,
  narrator: null,
  mediaKind: 'audiobook',
  series,
});

/** A one-file book with a series tag, by an author. */
const book = (folder: string, title: string, author: string, series: string | null) =>
  scanned(`${folder}/book.m4b`, { album: title, albumArtist: author, kindTags: tags(series) });

function scan(db: Db, files: ScannedFile[]) {
  const rootId = upsertRoot(
    db,
    { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
    1,
    newId,
  );
  const { listed, tags: read } = splitScanned(files);
  applyScan(db, {
    rootId,
    rootLocation: ROOT,
    listed,
    tags: read,
    folderCovers: new Map(),
    now: 1,
    newId,
  });
}

const idOf = (db: Db, folder: string) =>
  db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.location, `${ROOT}/${folder}`))
    .get()?.id ?? '';

const titles = (db: Db, key: string) => getSeries(db, ME, key)?.books.map((b) => b.book.title);

describe('series names', () => {
  it('reads series as servers write them', () => {
    expect(parseSeries('Dune #1, Dune Chronicles #1')).toEqual([
      { name: 'Dune', position: '1' },
      { name: 'Dune Chronicles', position: '1' },
    ]);
    expect(parseSeries('Rivers of London, The #2.5')).toEqual([
      { name: 'Rivers of London, The', position: '2.5' },
    ]);
    expect(parseSeries('Discworld')).toEqual([{ name: 'Discworld', position: null }]);
    expect(parseSeries('Dune #1, Foundation')).toEqual([
      { name: 'Dune', position: '1' },
      { name: 'Foundation', position: null },
    ]);
    expect(parseSeries('  ')).toEqual([]);
    expect(parseSeries(null)).toEqual([]);
  });

  it('writes them back the same way', () => {
    const text = formatSeries([{ name: 'Dune', position: '1' }, { name: 'Dune Chronicles' }]);
    expect(text).toBe('Dune #1, Dune Chronicles');
    expect(parseSeries(text)).toEqual([
      { name: 'Dune', position: '1' },
      { name: 'Dune Chronicles', position: null },
    ]);
    expect(formatSeries([])).toBeNull();
    expect(formatSeries(undefined)).toBeNull();
  });

  it('takes the number a position starts with', () => {
    expect(seriesNumber('2')).toBe(2);
    expect(seriesNumber('2.5')).toBe(2.5);
    expect(seriesNumber('1-3')).toBe(1);
    expect(seriesNumber('Prequel')).toBeNull();
    expect(seriesNumber(null)).toBeNull();
  });

  it('compares names without case, article or “series”', () => {
    expect(seriesKey('The Expanse')).toBe(seriesKey('Expanse Series'));
    expect(seriesKey('Ånd & Ære')).toBe('and and ære');
    expect(seriesKey('Dune')).not.toBe(seriesKey('Dune Chronicles'));
  });
});

describe('reading order', () => {
  const at = (number: number | null, title: string) => ({ number, book: { title } });

  it('puts fractional numbers between whole ones and unnumbered books last', () => {
    const list = [
      at(null, 'Extra'),
      at(3, 'Three'),
      at(2.5, 'Novella'),
      at(1, 'One'),
      at(null, 'A'),
    ];
    expect(list.sort(compareInSeries).map((b) => b.book.title)).toEqual([
      'One',
      'Novella',
      'Three',
      'A',
      'Extra',
    ]);
  });

  it('finds the whole numbers no book has', () => {
    expect(missingNumbers([1, 2, 4, 2.5, null, 6])).toEqual([3, 5]);
    expect(missingNumbers([3])).toEqual([1, 2]);
    expect(missingNumbers([null])).toEqual([]);
    // A year is no position worth counting up to.
    expect(missingNumbers([1, 1999])).toEqual([]);
  });

  it('keeps the listener’s order and adds new books after it', () => {
    const b = (key: string) => ({
      bookKey: key,
      position: null,
      number: null,
      book: {} as never,
    });
    expect(
      applyOrder([b('a'), b('b'), b('c'), b('d')], ['c', 'gone', 'a']).map((x) => x.bookKey),
    ).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('series in the library', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb();
    scan(db, [
      book('dune-3', 'Children of Dune', 'Frank Herbert', 'Dune #3'),
      book('dune-1', 'Dune', 'Frank Herbert', 'Dune #1, Dune Chronicles #1'),
      book('dune-5', 'Chapterhouse: Dune', 'Frank Herbert', 'Dune #5'),
      book('dune-x', 'The Road to Dune', 'Frank Herbert', 'Dune'),
      book('expanse-1', 'Leviathan Wakes', 'James S. A. Corey', 'The Expanse #1'),
      book('alone', 'Project Hail Mary', 'Andy Weir', null),
    ]);
  });

  it('lists every series by name, with its books in order and its gaps', () => {
    const all = listSeries(db, ME);
    expect(all.map((s) => s.name)).toEqual(['Dune', 'Dune Chronicles', 'The Expanse']);
    const dune = all[0];
    expect(dune?.author).toBe('Frank Herbert');
    expect(dune?.books.map((b) => [b.book.title, b.position])).toEqual([
      ['Dune', '1'],
      ['Children of Dune', '3'],
      ['Chapterhouse: Dune', '5'],
      ['The Road to Dune', null],
    ]);
    expect(dune?.missing).toEqual([2, 4]);
    expect(dune?.ordered).toBe(false);
  });

  it('leaves out books the profile hid', () => {
    hideBooks(db, ME, [idOf(db, 'dune-3')], 5);
    expect(titles(db, 'dune')).toEqual(['Dune', 'Chapterhouse: Dune', 'The Road to Dune']);
  });

  it('keeps a listener’s own order, and goes back to the usual one', () => {
    moveInSeries(db, ME, 'dune', idOf(db, 'dune-x'), 0, 10);
    expect(titles(db, 'dune')).toEqual([
      'The Road to Dune',
      'Dune',
      'Children of Dune',
      'Chapterhouse: Dune',
    ]);
    expect(getSeries(db, ME, 'dune')?.ordered).toBe(true);
    setSeriesOrder(db, ME, 'dune', [], 20);
    expect(titles(db, 'dune')?.[0]).toBe('Dune');
    expect(getSeries(db, ME, 'dune')?.ordered).toBe(false);
  });

  it('merges a catalog’s series with a server’s when their books are the same work', () => {
    // A streamed copy of the first Expanse book under another series name, and the second one.
    const stream: Stream = {
      sourceKey: 'lv:1',
      name: 'LibriVox',
      url: 'https://audio.example/1.mp3',
    };
    const meta = (id: string, name: string, position: string): Meta => ({
      id,
      type: 'audiobook',
      name,
      author: 'James S. A. Corey',
      series: [{ name: 'Expanse, The', position }],
    });
    addStreamedBook(db, {
      addonUrl: 'https://addon.example/manifest.json',
      meta: meta('ol:1', 'Leviathan Wakes (Unabridged)', '1'),
      stream,
      now: 5,
      newId,
    });
    addStreamedBook(db, {
      addonUrl: 'https://addon.example/manifest.json',
      meta: meta('ol:2', 'Caliban’s War', '2'),
      stream: { ...stream, sourceKey: 'lv:2' },
      now: 5,
      newId,
    });
    const expanse = listSeries(db, ME).filter((s) => s.author === 'James S. A. Corey');
    expect(expanse).toHaveLength(1);
    // The same work twice is listed once: the listener's own file, as neither was played.
    expect(expanse[0]?.books.map((b) => [b.book.title, b.book.source])).toEqual([
      ['Leviathan Wakes', 'local'],
      ['Caliban’s War', 'addon'],
    ]);
  });

  it('takes the series of a work matched by hand over the files’ tags', () => {
    linkBook(db, idOf(db, 'alone'), { type: 'audiobook', id: 'ol:phm' }, 5, {
      title: 'Project Hail Mary',
      author: 'Andy Weir',
      cover: null,
      series: 'Standalones #7',
    });
    expect(getSeries(db, ME, 'standalones')?.books.map((b) => b.number)).toEqual([7]);
  });

  describe('next in the series', () => {
    it('offers the next number when the library lacks it', () => {
      expect(nextInSeries(db, ME, idOf(db, 'dune-1'))).toMatchObject({
        series: { key: 'dune', name: 'Dune' },
        book: null,
        number: 2,
      });
    });

    it('offers the next book when the library has it', () => {
      scan(db, [
        book('dune-1', 'Dune', 'Frank Herbert', 'Dune #1'),
        book('dune-2', 'Dune Messiah', 'Frank Herbert', 'Dune #2'),
        book('dune-3', 'Children of Dune', 'Frank Herbert', 'Dune #3'),
      ]);
      expect(nextInSeries(db, ME, idOf(db, 'dune-1'))?.book?.title).toBe('Dune Messiah');
      // A finished book is skipped.
      setFinished(db, ME, idOf(db, 'dune-2'), true, 5);
      expect(nextInSeries(db, ME, idOf(db, 'dune-1'))?.book?.title).toBe('Children of Dune');
    });

    it('follows the listener’s own order', () => {
      moveInSeries(db, ME, 'dune', idOf(db, 'dune-x'), 1, 10);
      expect(nextInSeries(db, ME, idOf(db, 'dune-1'))?.book?.title).toBe('The Road to Dune');
    });

    it('asks for the next number after the last book, and nothing for a book of no series', () => {
      expect(nextInSeries(db, ME, idOf(db, 'dune-5'))).toMatchObject({ book: null, number: 6 });
      expect(nextInSeries(db, ME, idOf(db, 'alone'))).toBeNull();
      // An unnumbered book at the end has nothing after it.
      expect(nextInSeries(db, ME, idOf(db, 'dune-x'))).toBeNull();
    });
  });

  it('syncs the listener’s order, checked, and older devices skip it', () => {
    const other = createTestDb();
    scan(other, [
      book('dune-1', 'Dune', 'Frank Herbert', 'Dune #1'),
      book('dune-3', 'Children of Dune', 'Frank Herbert', 'Dune #3'),
    ]);
    setSeriesOrder(db, ME, 'dune', [`${ROOT}/dune-3`, `${ROOT}/dune-1`], 30);
    const ops = collectOps(db, 0).filter((o) => o.type === 'seriesOrder');
    expect(ops).toHaveLength(1);
    applyOps(other, ops, 40, newId);
    expect(titles(other, 'dune')).toEqual(['Children of Dune', 'Dune']);

    // An older change, or one that isn't a list of keys, changes nothing.
    const op = (at: number, data: unknown) =>
      ({ type: 'seriesOrder', profile: ME, key: 'dune', at, data }) as Op;
    applyOps(other, [op(20, { books: [`${ROOT}/dune-1`] })], 50, newId);
    applyOps(other, [op(60, null)], 50, newId);
    expect(getSeriesOrder(other, ME, 'dune')).toEqual([`${ROOT}/dune-3`, `${ROOT}/dune-1`]);
    applyOps(other, [op(70, { books: [42, `${ROOT}/dune-1`] })], 50, newId);
    expect(getSeriesOrder(other, ME, 'dune')).toEqual([`${ROOT}/dune-1`]);
  });
});

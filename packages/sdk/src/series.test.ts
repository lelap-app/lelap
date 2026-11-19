import { describe, expect, it } from 'vitest';

import { orderSeriesVolumes, positionNumber } from './series';

const titles = (list: { title: string }[]) => list.map((v) => v.title);

describe('orderSeriesVolumes', () => {
  it('goes by position, half numbers between whole ones', () => {
    expect(
      titles(
        orderSeriesVolumes([
          { title: 'Two', position: '2' },
          { title: 'Prequel', position: '0.5', released: '2008' },
          { title: 'One', position: '1', released: '1997-06-26' },
          { title: 'One and a half', position: '1.5' },
        ]),
      ),
    ).toEqual(['Prequel', 'One', 'One and a half', 'Two']);
  });

  it('puts a book without a position after the last one released before it', () => {
    // Harry Potter as Wikidata has it: book 7 has no date, the play has no position.
    expect(
      titles(
        orderSeriesVolumes([
          { title: 'Cursed Child', released: '2016-07-31' },
          { title: 'Book 6', position: '6', released: '2005-07-16' },
          { title: 'Book 7', position: '7' },
          { title: 'Book 1', position: '1', released: '1997' },
          { title: 'Between', released: '2001' },
          { title: 'Before all', released: '1990' },
        ]),
      ),
    ).toEqual(['Before all', 'Book 1', 'Between', 'Book 6', 'Book 7', 'Cursed Child']);
  });

  it('lists books with neither last, by title', () => {
    expect(
      titles(
        orderSeriesVolumes([
          { title: 'Zed' },
          { title: 'Alpha' },
          { title: 'One', position: '1' },
          { title: 'Named', position: 'A' },
        ]),
      ),
    ).toEqual(['One', 'Alpha', 'Named', 'Zed']);
  });

  it('reads the number a position starts with', () => {
    expect(positionNumber('2.5')).toBe(2.5);
    expect(positionNumber('1-3')).toBe(1);
    expect(positionNumber('A')).toBeNull();
    expect(positionNumber(undefined)).toBeNull();
  });
});

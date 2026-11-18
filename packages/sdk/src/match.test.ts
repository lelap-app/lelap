import { describe, expect, it, vi } from 'vitest';

import { lookupWork } from './lookup';
import {
  authorKey,
  createWorkIndex,
  idsFromTags,
  matchStrength,
  normalizeId,
  normalizeIsbn,
  sameAuthor,
  splitAuthors,
  titleKey,
} from './match';

describe('titleKey', () => {
  it('folds case, accents, punctuation and a leading article', () => {
    expect(titleKey('The Left Hand of Darkness').full).toBe('left hand of darkness');
    expect(titleKey('Les Misérables').full).toBe('miserables');
    expect(titleKey('Harry Potter & the Philosopher’s Stone').full).toBe(
      'harry potter and the philosopher s stone',
    );
  });

  it('drops edition notes', () => {
    expect(titleKey('Dune (Unabridged)').full).toBe('dune');
    expect(titleKey('Dune [Unabridged]').full).toBe('dune');
    expect(titleKey('Dune: A Novel').full).toBe('dune');
  });

  it('sets series numbers apart', () => {
    expect(titleKey('Dune (Dune Chronicles, #1)')).toEqual({
      full: 'dune',
      main: 'dune',
      number: 1,
    });
    expect(titleKey('Harry Potter, Book 2').number).toBe(2);
    expect(titleKey('03 - The Dragon Reborn')).toMatchObject({ full: 'dragon reborn', number: 3 });
    expect(titleKey('Leviathan Wakes (The Expanse 1)').number).toBe(1);
  });

  it('keeps numbers that are the title', () => {
    expect(titleKey('1984').full).toBe('1984');
    expect(titleKey('11.22.63').full).toBe('11 22 63');
    expect(titleKey('Dune (1965)')).toMatchObject({ full: 'dune', number: null });
  });

  it('knows the main title without a subtitle', () => {
    expect(titleKey('Sapiens: A Brief History of Humankind').main).toBe('sapiens');
  });
});

describe('authors', () => {
  it('splits several people but keeps “Last, First” together', () => {
    expect(splitAuthors('Terry Pratchett, Neil Gaiman')).toEqual([
      'Terry Pratchett',
      'Neil Gaiman',
    ]);
    expect(splitAuthors('Pratchett, Terry')).toEqual(['Pratchett, Terry']);
    expect(splitAuthors('Le Guin, Ursula K.')).toEqual(['Le Guin, Ursula K.']);
    expect(splitAuthors('Douglas Preston & Lincoln Child')).toEqual([
      'Douglas Preston',
      'Lincoln Child',
    ]);
    expect(splitAuthors('Various')).toEqual([]);
    expect(splitAuthors(null)).toEqual([]);
  });

  it('reads “Last, First” and initials', () => {
    expect(authorKey('Le Guin, Ursula K.')).toEqual({ last: 'guin', first: 'ursula' });
    expect(authorKey('J. R. R. Tolkien')).toEqual({ last: 'tolkien', first: 'j' });
    expect(authorKey('Martin Luther King Jr.')).toEqual({ last: 'king', first: 'martin' });
  });

  it('tells people with one surname apart', () => {
    expect(sameAuthor('J.R.R. Tolkien', 'Tolkien, John Ronald Reuel')).toBe(true);
    expect(sameAuthor('Ursula K. Le Guin', 'Le Guin, Ursula K.')).toBe(true);
    expect(sameAuthor('Frank Herbert', 'Herbert')).toBe(true);
    expect(sameAuthor('Stephen King', 'Owen King')).toBe(false);
    expect(sameAuthor('Christopher Tolkien', 'J. R. R. Tolkien')).toBe(false);
    expect(sameAuthor('Unknown', 'Unknown')).toBe(false);
  });
});

describe('IDs', () => {
  it('turns ISBN-10 into ISBN-13 and refuses bad check digits', () => {
    expect(normalizeIsbn('0-441-01359-7')).toBe('9780441013593');
    expect(normalizeIsbn('978-0-441-01359-3')).toBe('9780441013593');
    expect(normalizeIsbn('9780441013594')).toBeNull();
    expect(normalizeIsbn('12345')).toBeNull();
  });

  it('normalises prefixes and values', () => {
    expect(normalizeId('ISBN:0441013597')).toBe('isbn:9780441013593');
    expect(normalizeId('asin:b002uzmlxm')).toBe('asin:B002UZMLXM');
    expect(normalizeId('ol:ol893415w')).toBe('ol:OL893415W');
    expect(normalizeId('asin:short')).toBeNull();
    expect(normalizeId('librivox:dune')).toBe('librivox:dune');
  });

  it('reads ISBNs and ASINs from tags in any spelling', () => {
    expect(
      idsFromTags({
        ISBN: '978-0-441-01359-3; 0441013597',
        AUDIBLE_ASIN: 'B002UZMLXM',
        '----:com.apple.iTunes:ASIN': ['b00b5hzgum'],
        TITLE: 'Dune',
        isbn13: 'not an isbn',
      }),
    ).toEqual(['isbn:9780441013593', 'asin:B002UZMLXM', 'asin:B00B5HZGUM']);
  });
});

describe('matching', () => {
  const dune = { title: 'Dune', authors: ['Frank Herbert'], ids: ['ol:OL893415W'] };

  it('links on a shared ID', () => {
    expect(
      matchStrength({ ...dune, ids: ['isbn:9780441013593'] }, { ids: ['isbn:0441013597'] }),
    ).toBe('id');
  });

  it('offers the same title and author after normalising', () => {
    expect(matchStrength(dune, { title: 'Dune (Unabridged)', authors: ['Herbert, Frank'] })).toBe(
      'title',
    );
  });

  it('needs an author on both sides', () => {
    expect(matchStrength(dune, { title: 'Dune', authors: [] })).toBeNull();
    expect(
      matchStrength({ title: 'Dune' }, { title: 'Dune', authors: ['Frank Herbert'] }),
    ).toBeNull();
  });

  it('keeps the same title by different authors apart', () => {
    expect(
      matchStrength(
        { title: 'The Outsider', authors: ['Stephen King'] },
        { title: 'The Outsider', authors: ['Albert Camus'] },
      ),
    ).toBeNull();
  });

  it('keeps books of one series apart by their numbers', () => {
    const second = { title: 'Harry Potter, Book 2', authors: ['J. K. Rowling'] };
    expect(
      matchStrength({ title: 'Harry Potter, Book 1', authors: ['J.K. Rowling'] }, second),
    ).toBeNull();
    expect(
      matchStrength({ title: 'Harry Potter', authors: ['J.K. Rowling'], series: 2 }, second),
    ).toBe('title');
    expect(
      matchStrength(
        { title: 'The Eye of the World', authors: ['Robert Jordan'], series: 1 },
        { title: '02 - The Great Hunt', authors: ['Robert Jordan'] },
      ),
    ).toBeNull();
  });

  it('does not match on a title that is only a number or nothing', () => {
    expect(
      matchStrength({ title: '01', authors: ['A B'] }, { title: '01', authors: ['A B'] }),
    ).toBeNull();
    expect(
      matchStrength({ title: '!!!', authors: ['A B'] }, { title: '???', authors: ['A B'] }),
    ).toBeNull();
  });
});

describe('createWorkIndex', () => {
  const index = createWorkIndex([
    { item: 'dune-tagged', title: 'Dune', authors: ['Frank Herbert'], ids: ['isbn:0441013597'] },
    {
      item: 'dune-other-edition',
      title: 'Dune',
      authors: ['Frank Herbert'],
      ids: ['isbn:9780593099322'],
    },
    { item: 'messiah', title: 'Dune Messiah', authors: ['Frank Herbert'] },
    { item: 'outsider', title: 'The Outsider', authors: ['Albert Camus'] },
  ]);

  it('answers by ID first', () => {
    expect(index.byId('isbn:9780441013593')).toEqual(['dune-tagged']);
    expect(index.find({ title: 'Dune', ids: ['ol:OL1W', 'isbn:9780441013593'] })).toEqual([
      { item: 'dune-tagged', strength: 'id' },
    ]);
  });

  it('falls back to title and author, other editions last', () => {
    expect(
      index.find({ title: 'Dune', authors: ['Frank Herbert'], ids: ['isbn:9780340960196'] }),
    ).toEqual([
      { item: 'dune-tagged', strength: 'title' },
      { item: 'dune-other-edition', strength: 'title' },
    ]);
    expect(index.find({ title: 'The Outsider', authors: ['Stephen King'] })).toEqual([]);
  });
});

describe('lookupWork', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('answers ISBNs and ASINs without a request', async () => {
    const fetch = vi.fn();
    expect(await lookupWork('isbn:0441013597', { fetch })).toEqual({ ids: ['isbn:9780441013593'] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads an Open Library work, its authors and its editions’ IDs', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/works/OL893415W.json'))
        return json({ title: 'Dune', authors: [{ author: { key: '/authors/OL79034A' } }] });
      if (url.endsWith('/authors/OL79034A.json')) return json({ name: 'Frank Herbert' });
      if (url.includes('/editions.json'))
        return json({
          entries: [{ isbn_10: ['0441013597'], identifiers: { amazon: ['B00B7NPRY8'] } }],
        });
      return new Response('', { status: 404 });
    });
    expect(await lookupWork('ol:OL893415W', { fetch, openLibrary: 'https://ol.test/' })).toEqual({
      title: 'Dune',
      authors: ['Frank Herbert'],
      ids: ['ol:OL893415W', 'isbn:9780441013593', 'asin:B00B7NPRY8'],
    });
    expect(fetch.mock.calls.every(([url]) => url.startsWith('https://ol.test/'))).toBe(true);
  });

  it('is null for what it cannot look up', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    expect(await lookupWork('ol:OL1W', { fetch })).toBeNull();
    expect(await lookupWork('librivox:dune', { fetch })).toBeNull();
  });
});

describe('false matches from the review', () => {
  const by = (title: string, author = 'Brandon Sanderson') => ({ title, authors: [author] });

  it('keeps books of one series with different subtitles apart', () => {
    expect(
      matchStrength(by('Mistborn: The Well of Ascension'), by('Mistborn: The Final Empire')),
    ).toBeNull();
    expect(matchStrength(by('Warriors: Fire and Ice'), by('Warriors - Into the Wild'))).toBeNull();
    expect(
      matchStrength(by('Dune', 'Frank Herbert'), by('Dune - Part Two', 'Frank Herbert')),
    ).toBeNull();
    // A subtitle left out on one side still matches.
    expect(matchStrength(by('Mistborn: The Final Empire'), by('Mistborn'))).toBe('title');
  });

  it('matches a title that is a number when both agree', () => {
    expect(matchStrength(by('1984', 'George Orwell'), by('1984', 'Orwell, George'))).toBe('title');
    expect(matchStrength(by('1984', 'George Orwell'), by('1985', 'George Orwell'))).toBeNull();
  });

  it('reads authors with initials and narrators right', () => {
    expect(splitAuthors('Terry Pratchett, J. K. Smith')).toEqual([
      'Terry Pratchett',
      'J. K. Smith',
    ]);
    expect(splitAuthors('Frank Herbert, read by Scott Brick')).toEqual(['Frank Herbert']);
    expect(splitAuthors('Frank Herbert (narrated by Simon Vance)')).toEqual(['Frank Herbert']);
  });
});

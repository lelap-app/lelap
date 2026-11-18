import { describe, expect, it } from 'vitest';

import {
  catalogPath,
  encodeExtra,
  libraryPath,
  metaPath,
  parseExtra,
  parseRoute,
  streamPath,
} from './paths';

describe('paths', () => {
  it('builds catalog paths with and without extras', () => {
    expect(catalogPath('audiobook', 'new')).toBe('catalog/audiobook/new.json');
    expect(catalogPath('audiobook', 'new', { skip: '20', search: 'a&b=c d' })).toBe(
      'catalog/audiobook/new/search=a%26b%3Dc%20d&skip=20.json',
    );
  });

  it('routes the library listing', () => {
    expect(libraryPath()).toBe('library/audiobook/all.json');
    expect(parseRoute(libraryPath())).toEqual({
      resource: 'library',
      type: 'audiobook',
      id: 'all',
    });
  });

  it('drops empty extras and sorts keys', () => {
    expect(encodeExtra({ skip: '0', genre: '', search: 'x' })).toBe('search=x&skip=0');
  });

  it('round-trips catalog routes', () => {
    const extra = { search: 'Dune & sand/worms', genre: 'sci-fi' };
    expect(parseRoute(catalogPath('audiobook', 'top', extra))).toEqual({
      resource: 'catalog',
      type: 'audiobook',
      id: 'top',
      extra,
    });
  });

  it('round-trips IDs with colons, slashes and plus signs', () => {
    const id = 'librivox:a/b+c d';
    expect(parseRoute(metaPath('audiobook', id))).toEqual({
      resource: 'meta',
      type: 'audiobook',
      id,
    });
    expect(parseRoute(streamPath('podcast', id))).toEqual({
      resource: 'stream',
      type: 'podcast',
      id,
    });
  });

  it('accepts query-string style extras from other clients', () => {
    expect(parseExtra('search=secret+garden&skip=20')).toEqual({
      search: 'secret garden',
      skip: '20',
    });
    expect(parseExtra('search=100%')).toEqual({ search: '100%' });
  });

  it('parses the manifest and rejects everything else', () => {
    expect(parseRoute('/manifest.json')).toEqual({ resource: 'manifest' });
    expect(parseRoute('meta/movie/x:1.json')).toBeNull();
    expect(parseRoute('meta/audiobook/x:1/extra.json')).toBeNull();
    expect(parseRoute('catalog/audiobook.json')).toBeNull();
    expect(parseRoute('stream/audiobook/x:1')).toBeNull();
    expect(parseRoute('scrobble/audiobook/x:1.json')).toBeNull();
  });
});

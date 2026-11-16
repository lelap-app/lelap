import { describe, expect, it } from 'vitest';

import { htmlToText, naturalCompare, parseDuration, searchWords } from '../src/text';

describe('parseDuration', () => {
  it('reads seconds, minutes and hours', () => {
    expect(parseDuration('808.54')).toBe(808_540);
    expect(parseDuration('13:28')).toBe(808_000);
    expect(parseDuration('07:25')).toBe(445_000);
    expect(parseDuration('1:02:03')).toBe(3_723_000);
    expect(parseDuration('9:08:25')).toBe(32_905_000);
    expect(parseDuration(90)).toBe(90_000);
  });

  it('rejects anything else', () => {
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('about an hour')).toBeUndefined();
    expect(parseDuration('1:2:3:4')).toBeUndefined();
    expect(parseDuration(undefined)).toBeUndefined();
  });
});

describe('htmlToText', () => {
  it('keeps line breaks, drops tags and decodes entities', () => {
    expect(
      htmlToText(
        '<a href="x">LibriVox</a> recording.<br /> Read by A &amp; B&#39;s friend<p>Next</p>',
      ),
    ).toBe("LibriVox recording.\nRead by A & B's friend\n\nNext");
  });

  it('collapses whitespace and blank lines', () => {
    expect(htmlToText('  one \n\n\n\n two  ')).toBe('one\n\ntwo');
  });
});

describe('searchWords', () => {
  it('lowercases and keeps only letters and digits', () => {
    expect(searchWords('The Secret Garden')).toEqual(['the', 'secret', 'garden']);
    expect(searchWords('Brontë 1847')).toEqual(['brontë', '1847']);
  });

  it('strips Lucene syntax so input cannot widen the query', () => {
    expect(searchWords('title:x) OR (collection:* AND "a"~2^5 -NOT \\')).toEqual([
      'title',
      'or',
      'collection',
      'and',
      'not',
    ]);
    expect(searchWords('*:*')).toEqual([]);
  });

  it('drops one-letter words unless nothing else is left', () => {
    expect(searchWords("alice's adventures")).toEqual(['alice', 'adventures']);
    expect(searchWords('x')).toEqual(['x']);
  });
});

describe('naturalCompare', () => {
  it('sorts numbers inside names by value', () => {
    expect(['part10.mp3', 'part2.mp3', 'part1.mp3'].sort(naturalCompare)).toEqual([
      'part1.mp3',
      'part2.mp3',
      'part10.mp3',
    ]);
  });
});

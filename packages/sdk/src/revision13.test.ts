import { describe, expect, it } from 'vitest';

import { LATEST_PROTOCOL_VERSION, LibraryResponse, PlaceReport, RequestHeaders } from './protocol';

// Revision 13 (M135): a library file's summary, language and series and the add-on's own `ref`, a
// Digest login for a library, and each file's length and `ref` in a place report.

describe('revision 13', () => {
  it('is the newest revision', () => {
    expect(LATEST_PROTOCOL_VERSION).toBeGreaterThanOrEqual(13);
  });

  it('reads a file with its description, language, series and ref', () => {
    const parsed = LibraryResponse.parse({
      files: [
        {
          path: 'Frank Herbert/Dune/Dune.m4b',
          url: 'http://192.168.1.20:8080/get/m4b/1',
          description: 'A desert planet.',
          language: 'en',
          series: [{ name: 'Dune', position: '1' }],
          ref: 'http://192.168.1.20:8080/progression/1',
        },
      ],
      digest: { username: 'kim', password: 'secret' },
    });
    expect(parsed.files[0]?.series?.[0]?.position).toBe('1');
    expect(parsed.files[0]?.ref).toContain('progression');
    expect(parsed.digest?.username).toBe('kim');
  });

  it('refuses a Digest login without a user name', () => {
    expect(
      LibraryResponse.safeParse({ files: [], digest: { username: '', password: 'x' } }).success,
    ).toBe(false);
  });

  it('keeps the header that carries a Digest login for the app alone', () => {
    expect(RequestHeaders.safeParse({ 'X-Lelap-Digest': 'a:b' }).success).toBe(false);
  });

  it('describes a place report with lengths and refs', () => {
    const file = {
      path: 'A/B/1.mp3',
      url: 'https://example.org/1.mp3',
      durationMs: 60_000,
      ref: 'r1',
    };
    const report = PlaceReport.parse({
      file,
      files: [file, { path: 'A/B/2.mp3', url: 'https://example.org/2.mp3' }],
      positionMs: 1000,
      at: 1_700_000_000_000,
      finished: false,
    });
    expect(report.files[0]?.durationMs).toBe(60_000);
    expect(report.files[1]?.ref).toBeUndefined();
  });
});

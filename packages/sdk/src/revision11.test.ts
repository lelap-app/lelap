import { describe, expect, it } from 'vitest';

import { locatePath } from './paths';
import {
  LATEST_PROTOCOL_VERSION,
  LibraryResponse,
  LocateRequest,
  LocateResponse,
  Manifest,
  offersLocate,
} from './protocol';

// Revision 11 (M100): a library listing may hand back new settings, and an add-on inside the app
// may say where its files are before a book streams.

const inApp = {
  id: 'org.example.server',
  version: '1.0.0',
  protocol: 1 as const,
  protocolVersion: 11,
  name: 'Server',
  description: 'A media server',
  types: ['audiobook' as const],
  catalogs: [],
  resources: ['library', 'locate'],
  sandbox: { hosts: [] },
  settings: [{ key: 'url', label: 'Address', type: 'url' as const, host: true }],
};

describe('revision 11', () => {
  it('is the newest revision', () => {
    expect(LATEST_PROTOCOL_VERSION).toBe(11);
  });

  it('locates files only for an add-on inside the app with a library', () => {
    expect(offersLocate(Manifest.parse(inApp))).toBe(true);
    expect(offersLocate(Manifest.parse({ ...inApp, resources: ['library'] }))).toBe(false);
    const web = { ...inApp, sandbox: undefined, settings: undefined, resources: ['locate'] };
    expect(Manifest.safeParse(web).success).toBe(false);
    expect(locatePath()).toBe('locate/audiobook/all.json');
  });

  it('takes settings with a listing, by field key', () => {
    const parsed = LibraryResponse.parse({ files: [], settings: { url: 'https://new.example' } });
    expect(parsed.settings).toEqual({ url: 'https://new.example' });
    expect(LibraryResponse.safeParse({ files: [], settings: { url: 3 } }).success).toBe(false);
  });

  it('asks with at least one file, and may answer with none', () => {
    const file = { path: 'A/B/01.mp3', url: 'https://nas.example/01.mp3' };
    expect(LocateRequest.safeParse({ files: [] }).success).toBe(false);
    expect(LocateRequest.parse({ files: [file] }).files).toEqual([file]);
    expect(LocateResponse.parse({ files: [] }).files).toEqual([]);
    expect(LocateResponse.safeParse({ files: [{ ...file, url: 'ftp://x' }] }).success).toBe(false);
  });
});

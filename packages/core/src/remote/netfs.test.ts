import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import {
  addRemoteRoot,
  listRoots,
  remoteLocation,
  remoteName,
  setNetServerRefused,
} from '../library/scan';
import { libraryRoots, type RemoteSource } from '../schema';
import { createSecretBox, plainBox, setSecretBox } from '../secrets';
import {
  NETFS_LOGIN_HEADER,
  netfsHeaders,
  netfsListed,
  netRootUri,
  parseNetAddress,
  sftpSecret,
  sftpSecretJson,
} from './netfs';

const smb: Extract<RemoteSource, { type: 'smb' }> = {
  type: 'smb',
  url: 'smb://NAS.local/Media/Audio Books',
  username: 'me',
  password: 'secret',
};

const sftp: Extract<RemoteSource, { type: 'sftp' }> = {
  type: 'sftp',
  url: 'sftp://box.example.org:2222/home/me/Books',
  username: 'me',
  hostKey: 'SHA256:abc',
  secret: sftpSecretJson({ privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n…', passphrase: 'p' }),
};

afterEach(() => setSecretBox(plainBox));

describe('SMB and SFTP addresses', () => {
  it('reads hosts, ports and folders, typed with spaces or encoded', () => {
    expect(parseNetAddress('smb://NAS.local/Media/Audio Books')).toEqual({
      scheme: 'smb',
      host: 'nas.local',
      port: null,
      segments: ['Media', 'Audio Books'],
    });
    expect(parseNetAddress('smb://nas.local:445/Media/Audio%20Books/')?.segments).toEqual([
      'Media',
      'Audio Books',
    ]);
    expect(parseNetAddress('sftp://me@[fd00::2]:2222/srv')).toEqual({
      scheme: 'sftp',
      host: '[fd00::2]',
      port: 2222,
      segments: ['srv'],
    });
    expect(parseNetAddress('sftp://host')?.segments).toEqual([]);
  });

  it('refuses what is not a folder address', () => {
    expect(parseNetAddress('smb://nas.local')).toBeNull(); // no share
    expect(parseNetAddress('smb://nas.local/a/../b')).toBeNull();
    expect(parseNetAddress('https://nas.local/a')).toBeNull();
    expect(parseNetAddress('sftp://host:70000/a')).toBeNull();
  });

  it('names files the same way on every device, with addresses native code can read', () => {
    expect(netRootUri(smb)).toBe('smb://nas.local/Media/Audio%20Books/');
    expect(netRootUri({ ...sftp, url: 'sftp://host' })).toBe('sftp://host/');
    expect(remoteName(smb)).toBe('nas.local/Media/Audio Books');
    expect(remoteLocation(sftp)).toBe('sftp:box.example.org:2222/home/me/Books');
    const [file] = netfsListed(smb, [{ path: 'Dune #1/01 Part?.mp3', size: 9, modifiedAt: 5 }]);
    expect(file).toEqual({
      location: 'smb:nas.local/Media/Audio Books/Dune #1/01 Part?.mp3',
      relPath: 'Dune #1/01 Part?.mp3',
      name: '01 Part?.mp3',
      size: 9,
      modifiedAt: 5,
      uri: 'smb://nas.local/Media/Audio%20Books/Dune%20%231/01%20Part%3F.mp3',
    });
    expect(netfsListed(smb, [{ path: '../x.mp3', size: 1, modifiedAt: 0 }])).toEqual([]);
  });

  it('hands native code the login and, for SFTP, the trusted host key', () => {
    expect(JSON.parse(netfsHeaders(smb)[NETFS_LOGIN_HEADER] ?? '')).toEqual({
      username: 'me',
      password: 'secret',
    });
    expect(JSON.parse(netfsHeaders(sftp)[NETFS_LOGIN_HEADER] ?? '')).toEqual({
      username: 'me',
      hostKey: 'SHA256:abc',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n…',
      passphrase: 'p',
    });
    expect(sftpSecret({ ...sftp, secret: '' })).toEqual({});
  });

  it('keeps the password and the private key sealed in the database', () => {
    setSecretBox(
      createSecretBox(new Uint8Array(randomBytes(32)), (n) => new Uint8Array(randomBytes(n))),
    );
    const db = createTestDb();
    addRemoteRoot(db, smb, 1, () => 'a');
    addRemoteRoot(db, sftp, 1, () => 'b');
    for (const row of db.select().from(libraryRoots).all()) {
      const stored = JSON.stringify(row.remote);
      expect(stored).not.toContain('"secret"}');
      expect(stored).not.toContain('"password":"secret"');
      expect(stored).not.toContain('PRIVATE KEY');
    }
    const roots = listRoots(db);
    expect(roots.find((r) => r.id === 'a')?.remote).toEqual(smb);
    expect(roots.find((r) => r.id === 'b')?.remote).toEqual(sftp);
  });

  it('marks a server whose login or host key was refused, and clears the mark', () => {
    const db = createTestDb();
    addRemoteRoot(db, sftp, 1, () => 'b');
    addRemoteRoot(db, smb, 1, () => 'a');
    expect(setNetServerRefused(db, 'b', 'host-key', 2)).toBe(true);
    expect(setNetServerRefused(db, 'b', 'host-key', 3)).toBe(false);
    expect(setNetServerRefused(db, 'a', 'host-key', 3)).toBe(false);
    const refused = listRoots(db).find((r) => r.id === 'b')?.remote;
    expect(refused).toEqual({ ...sftp, refused: 'host-key' });
    expect(setNetServerRefused(db, 'b', null, 4)).toBe(true);
    expect(listRoots(db).find((r) => r.id === 'b')?.remote).toEqual(sftp);
  });
});

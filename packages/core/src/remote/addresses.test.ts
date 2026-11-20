import { describe, expect, it } from 'vitest';

import {
  AddressBook,
  answersAt,
  atAddress,
  probeAddresses,
  rebaseUri,
  serverAddresses,
  tryAddresses,
} from './addresses';
import { RemoteError } from './http';

const HOME = 'http://192.168.1.5:13378';
const AWAY = 'https://abs.example.org/abs';

const abs = {
  type: 'audiobookshelf' as const,
  url: HOME,
  alsoUrl: AWAY,
  username: 'me',
  userId: 'u1',
  token: 'key',
  libraryIds: ['l1'],
  profileId: 'p1',
};

const silent = () => Promise.reject(new RemoteError(0, 'No answer'));

describe('home and away addresses', () => {
  it('lists the own address first and leaves out an empty or repeated second one', () => {
    expect(serverAddresses(abs)).toEqual([HOME, AWAY]);
    expect(serverAddresses({ ...abs, alsoUrl: ' ' })).toEqual([HOME]);
    expect(serverAddresses({ ...abs, alsoUrl: `${HOME}/` })).toEqual([HOME]);
    expect(
      serverAddresses({ type: 'smb', url: 'smb://nas/share', username: '', password: '' }),
    ).toEqual([]);
  });

  it('moves an address below one address to the other, path and query kept', () => {
    expect(rebaseUri(`${HOME}/api/items/1/file/2?x=1`, HOME, AWAY)).toBe(
      `${AWAY}/api/items/1/file/2?x=1`,
    );
    expect(rebaseUri(`${AWAY}/api/items/1`, `${AWAY}/`, HOME)).toBe(`${HOME}/api/items/1`);
    // Only below the address, not a neighbour that starts the same.
    expect(rebaseUri('http://192.168.1.50/x', 'http://192.168.1.5', AWAY)).toBeNull();
    // WebDAV stores addresses as a URL parser writes them.
    expect(rebaseUri('http://nas:8080/My%20Books/a.mp3', 'HTTP://NAS:8080/My Books/', AWAY)).toBe(
      `${AWAY}/a.mp3`,
    );
    // A parsed URI moved to a typed address with a space stays parsed.
    expect(rebaseUri(`${HOME}/dav/01.mp3`, `${HOME}/dav`, 'https://example.com/My Books')).toBe(
      'https://example.com/My%20Books/01.mp3',
    );
  });

  it('moves only the server’s own files', () => {
    expect(atAddress(`${HOME}/api/x`, abs, AWAY)).toBe(`${AWAY}/api/x`);
    expect(atAddress(`${HOME}/api/x`, abs, HOME)).toBe(`${HOME}/api/x`);
    expect(atAddress('https://elsewhere.org/x', abs, AWAY)).toBe('https://elsewhere.org/x');
  });

  it('tries the other address once on a connection error and keeps the one that answered', async () => {
    const book = new AddressBook();
    const asked: string[] = [];
    const request = async (address: string) => {
      asked.push(address);
      if (address === HOME) throw new RemoteError(0, 'No answer');
      return 'ok';
    };
    await expect(tryAddresses(book, 'r1', [HOME, AWAY], request)).resolves.toBe('ok');
    expect(asked).toEqual([HOME, AWAY]);
    expect(book.current('r1', [HOME, AWAY])).toBe(AWAY);
    // The next request starts at the address that answered.
    await tryAddresses(book, 'r1', [HOME, AWAY], request);
    expect(asked).toEqual([HOME, AWAY, AWAY]);
  });

  it('counts a timeout as no answer, but not an HTTP error', async () => {
    const book = new AddressBook();
    const timedOut = await tryAddresses(book, 'r1', [HOME, AWAY], async (a) => {
      if (a === HOME) throw new RemoteError(408, 'No answer in time');
      return a;
    });
    expect(timedOut).toBe(AWAY);

    const other = new AddressBook();
    const asked: string[] = [];
    const refused = tryAddresses(other, 'r1', [HOME, AWAY], async (a) => {
      asked.push(a);
      throw new RemoteError(401, 'Refused');
    });
    await expect(refused).rejects.toMatchObject({ status: 401 });
    expect(asked).toEqual([HOME]);
    // An error decides nothing: it may come from another device at that address.
    other.answered('r1', AWAY);
    await refused.catch(() => {});
    expect(other.current('r1', [HOME, AWAY])).toBe(AWAY);
  });

  it('gives the first address’s error when neither answers', async () => {
    const book = new AddressBook();
    const error = await tryAddresses(book, 'r1', [HOME, AWAY], async (a) => {
      throw new RemoteError(0, `silent at ${a}`);
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(`silent at ${HOME}`);
  });

  it('forgets the winner when the network changes, and drops answers from before it', async () => {
    const book = new AddressBook();
    book.answered('r1', AWAY);
    expect(book.current('r1', [HOME, AWAY])).toBe(AWAY);
    const before = book.network;
    book.networkChanged();
    expect(book.current('r1', [HOME, AWAY])).toBe(HOME);
    // A request that started on the old network answers late: it decides nothing.
    book.answered('r1', AWAY, before);
    expect(book.current('r1', [HOME, AWAY])).toBe(HOME);
  });

  it('takes the first address a probe hears from, and requests wait for the probe', async () => {
    const book = new AddressBook();
    let answerHome: (ok: boolean) => void = () => {};
    const probe = probeAddresses(book, 'r1', [HOME, AWAY], (a) =>
      a === HOME ? new Promise((resolve) => (answerHome = resolve)) : Promise.resolve(true),
    );
    await expect(probe).resolves.toBe(AWAY);
    answerHome(true);
    const asked: string[] = [];
    await tryAddresses(book, 'r1', [HOME, AWAY], async (a) => asked.push(a));
    expect(asked[0]).toBe(AWAY);
  });

  it('keeps the own address when a probe hears from neither', async () => {
    const book = new AddressBook();
    await expect(probeAddresses(book, 'r1', [HOME, AWAY], silent)).resolves.toBeNull();
    expect(book.current('r1', [HOME, AWAY])).toBe(HOME);
  });

  it('asks each kind of server something only it answers', async () => {
    const seen: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/ping')) return new Response('{"success":true}');
      if (url.endsWith('/System/Info/Public')) return new Response('{"Id":"abc"}');
      if (url.endsWith('/portal')) return new Response('<html>Sign in to Wi-Fi</html>');
      return new Response('', { status: 207 });
    };
    expect(await answersAt(fetcher, abs, `${AWAY}/`)).toBe(true);
    expect(
      await answersAt(
        fetcher,
        { ...abs, type: 'jellyfin', deviceId: 'd' } as Parameters<typeof answersAt>[1],
        HOME,
      ),
    ).toBe(true);
    expect(
      await answersAt(
        fetcher,
        { type: 'webdav', url: `${HOME}/dav`, username: 'me', password: 'pw' },
        `${HOME}/dav`,
      ),
    ).toBe(true);
    expect(seen).toEqual([
      `GET ${AWAY}/ping`,
      `GET ${HOME}/System/Info/Public`,
      `PROPFIND ${HOME}/dav/`,
    ]);
    const portal = async () => new Response('<html>Sign in to Wi-Fi</html>');
    expect(await answersAt(portal, abs, HOME)).toBe(false);
  });
});

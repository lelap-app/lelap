import { createServer } from 'node:net';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  AddressBook,
  answersAt,
  atAddress,
  probeAddresses,
  tryAddresses,
} from '../src/remote/addresses';
import { listWebdav, webdavHeaders } from '../src/remote/webdav';
import { testLibrary } from './fixtures';
import { reachable, seedWebdav, webdav } from './servers';

const library = testLibrary();

/** A port nothing listens on: taken from the system, then let go, so a connection is refused. */
async function refusingPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('No port');
  return address.port;
}

describe('home and away addresses against rclone serve webdav (M146)', () => {
  // The server's own address is "home", where nothing answers now; the real one is "away".
  let home: string;
  const away = webdav.url;

  beforeAll(async () => {
    await reachable(webdav.url);
    await seedWebdav(library);
    home = new URL(new URL(away).pathname, `http://127.0.0.1:${await refusingPort()}`).href;
  });

  it('lists from the other address when the first refuses, named by the own address', async () => {
    const book = new AddressBook();
    const remote = { type: 'webdav' as const, ...webdav, url: home, alsoUrl: away };
    const tried: string[] = [];
    const files = await tryAddresses(book, 'root', [home, away], (address) => {
      tried.push(address);
      return listWebdav(fetch, { ...webdav, url: address }, { nameAt: home });
    });
    expect(tried).toEqual([home, away]);
    expect(book.current('root', [home, away])).toBe(away);
    expect(files.map((f) => f.relPath).sort()).toEqual([...library.keys()].sort());
    const homeHost = new URL(home).host;
    for (const file of files) {
      expect(file.location.startsWith(`webdav:${homeHost}/`), file.location).toBe(true);
      expect(file.uri.startsWith(home), file.uri).toBe(true);
    }

    // Played from the address that answered, the stored address moved as the request starts.
    const file = files.find((f) => f.name === '01 Arrival.mp3');
    if (!file) throw new Error('No 01 Arrival.mp3');
    const uri = atAddress(file.uri, remote, book.current('root', [home, away]));
    const response = await fetch(uri, { headers: webdavHeaders(webdav) });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(library.get(file.relPath));
  });

  it('finds the answering address with a probe before any request', async () => {
    const book = new AddressBook();
    const remote = { type: 'webdav' as const, ...webdav, url: home, alsoUrl: away };
    const found = await probeAddresses(book, 'root', [home, away], (address) =>
      answersAt(fetch, remote, address),
    );
    expect(found).toBe(away);
    // After a network change the own address is tried first again.
    book.networkChanged();
    expect(book.current('root', [home, away])).toBe(home);
  });
});

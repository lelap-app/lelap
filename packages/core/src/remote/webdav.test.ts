import { describe, expect, it } from 'vitest';

import { basicAuth, RemoteError } from './http';
import { checkWebdav, listWebdav, parseMultistatus, webdavRoot } from './webdav';

const folder = (path: string, entries: string) => `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
  ${entries}
</d:multistatus>`;

const file = (href: string, size: number) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${size}</d:getcontentlength><d:getlastmodified>Mon, 02 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

const dir = (href: string) =>
  `<D:response xmlns:D="DAV:"><D:href>${href}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;

describe('WebDAV', () => {
  it('builds Basic auth from UTF-8', () => {
    expect(basicAuth('aladdin', 'opensesame')).toBe('Basic YWxhZGRpbjpvcGVuc2VzYW1l');
    expect(basicAuth('ø', 'å')).toBe('Basic w7g6w6U=');
  });

  it('reads a folder listing, whatever prefix the server uses', () => {
    const root = webdavRoot('https://cloud.example.org/remote.php/dav/files/me/Audiobooks');
    const entries = parseMultistatus(
      folder(
        '/remote.php/dav/files/me/Audiobooks/',
        dir('/remote.php/dav/files/me/Audiobooks/Dune/') +
          file('/remote.php/dav/files/me/Audiobooks/Loose%20one.mp3', 42),
      ),
      root,
    );
    const rows = entries.map((e) => [e.url.pathname, e.folder, e.size]);
    expect(rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['/remote.php/dav/files/me/Audiobooks/Dune/', true, 0],
      ['/remote.php/dav/files/me/Audiobooks/Loose%20one.mp3', false, 42],
    ]);
  });

  it('walks folders one level at a time with the login', async () => {
    const base = '/dav/Audiobooks/';
    const answers: Record<string, string> = {
      [base]: folder(base, dir(`${base}Dune/`) + file(`${base}Loose.mp3`, 5)),
      [`${base}Dune/`]: folder(`${base}Dune/`, file(`${base}Dune/01.mp3`, 10)),
    };
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(answers[new URL(url).pathname] ?? '', { status: 207 });
    };
    const files = await listWebdav(fetcher, {
      url: 'https://nas.example.org/dav/Audiobooks',
      username: 'me',
      password: 'secret',
    });
    expect(files.map((f) => [f.relPath, f.location])).toEqual([
      ['Loose.mp3', 'webdav:nas.example.org/dav/Audiobooks/Loose.mp3'],
      ['Dune/01.mp3', 'webdav:nas.example.org/dav/Audiobooks/Dune/01.mp3'],
    ]);
    expect(seen[0]?.init?.method).toBe('PROPFIND');
    expect((seen[0]?.init?.headers as Record<string, string>).Depth).toBe('1');
  });

  const source = { url: 'https://nas.example.org/dav/Audiobooks', username: 'me', password: 'pw' };

  // A server that takes the request and never answers, until the request is cancelled.
  const silent = async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });

  it('gives up on a folder that does not answer in time', async () => {
    const error = await listWebdav(silent, source, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).message).toMatch(/did not answer within/);
  });

  it('reports a network failure as no answer', async () => {
    const offline = async () => {
      throw new TypeError('Network request failed');
    };
    const error = await checkWebdav(offline, source).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).status).toBe(0);
    expect((error as RemoteError).message).toMatch(/No answer from the WebDAV server/);
  });

  it('checks a server by reading only the folder entered', async () => {
    const base = '/dav/Audiobooks/';
    const urls: string[] = [];
    const fetcher = async (url: string) => {
      urls.push(url);
      return new Response(folder(base, dir(`${base}Dune/`) + file(`${base}Loose.mp3`, 5)), {
        status: 207,
      });
    };
    expect(await checkWebdav(fetcher, source)).toEqual({ folders: 1, files: 1 });
    expect(urls).toEqual(['https://nas.example.org/dav/Audiobooks/']);
  });

  it('checks the login before anything else', async () => {
    const refused = async () => new Response('', { status: 401 });
    await expect(checkWebdav(refused, source)).rejects.toThrow(/refused the login/);
  });
});

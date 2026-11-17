import { describe, expect, it } from 'vitest';

import { basicAuth } from './http';
import { listWebdav, parseMultistatus, webdavRoot } from './webdav';

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
});

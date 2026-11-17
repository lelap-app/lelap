import type { ListedFile } from '../library/scan';
import { asArray, isNode, parseXml, textOf } from '../podcasts/xml';
import { basicAuth, failure, type Fetch } from './http';

export type WebdavSource = { url: string; username: string; password: string };

const MAX_FOLDERS = 5_000;

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`;

export const webdavHeaders = (source: WebdavSource): Record<string, string> => ({
  Authorization: basicAuth(source.username, source.password),
});

/** The server's folder URL, always ending in `/`. */
export function webdavRoot(url: string): URL {
  const root = new URL(url.trim());
  return root.pathname.endsWith('/') ? root : new URL(`${root.origin}${root.pathname}/`);
}

/** A stable name for a file on this server, the same on every device: `webdav:host/path`. */
export const webdavLocation = (url: URL) => `webdav:${url.host}${decodeURIComponent(url.pathname)}`;

type Entry = { url: URL; folder: boolean; size: number; modifiedAt: number };

/** One folder's entries from a `PROPFIND` with `Depth: 1` (the folder itself left out). */
export function parseMultistatus(xml: string, folder: URL): Entry[] {
  const doc = parseXml(xml);
  // Servers write `d:`, `D:` or no prefix; drop namespace prefixes from keys.
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!isNode(node)) return node;
    // Merge, not overwrite: one listing can mix `d:response` and `D:response`.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      const key = k.startsWith('@_') ? k : k.replace(/^[^:]+:/, '');
      const value = strip(v);
      out[key] = key in out ? [...asArray(out[key]), ...asArray(value)] : value;
    }
    return out;
  };
  const root = strip(doc) as Record<string, unknown>;
  const multistatus = asArray(root.multistatus).find(isNode);
  if (!multistatus) return [];
  const entries: Entry[] = [];
  for (const response of asArray(multistatus.response).filter(isNode)) {
    const href = textOf(response.href);
    if (!href) continue;
    const url = new URL(href, folder);
    if (url.pathname.replace(/\/$/, '') === folder.pathname.replace(/\/$/, '')) continue;
    const okStat =
      asArray(response.propstat)
        .filter(isNode)
        .find((p) => /\s200\s/.test(` ${textOf(p.status)} `)) ??
      asArray(response.propstat).find(isNode);
    const prop = okStat && isNode(okStat) ? asArray(okStat.prop).find(isNode) : undefined;
    const type = prop ? asArray(prop.resourcetype).find(isNode) : undefined;
    const isFolder = type !== undefined && 'collection' in type;
    const modified = Date.parse(textOf(prop?.getlastmodified));
    entries.push({
      url,
      folder: isFolder || url.pathname.endsWith('/'),
      size: Number(textOf(prop?.getcontentlength)) || 0,
      modifiedAt: Number.isFinite(modified) ? modified : 0,
    });
  }
  return entries;
}

/**
 * Every file below the server folder, walked one level at a time (many servers refuse
 * `Depth: infinity`). The same shape as a folder on the phone, so the same rules make books.
 */
export async function listWebdav(fetcher: Fetch, source: WebdavSource): Promise<ListedFile[]> {
  const root = webdavRoot(source.url);
  const headers = { ...webdavHeaders(source), Depth: '1', 'Content-Type': 'application/xml' };
  const files: ListedFile[] = [];
  const queue: URL[] = [root];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const folder = queue.shift() as URL;
    if (seen.has(folder.href) || seen.size >= MAX_FOLDERS) continue;
    seen.add(folder.href);
    const response = await fetcher(folder.href, {
      method: 'PROPFIND',
      headers,
      body: PROPFIND_BODY,
    });
    if (response.status !== 207 && !response.ok) throw failure(response.status, 'WebDAV server');
    for (const entry of parseMultistatus(await response.text(), folder)) {
      if (entry.folder) {
        const url = entry.url;
        queue.push(url.pathname.endsWith('/') ? url : new URL(`${url.origin}${url.pathname}/`));
        continue;
      }
      const relPath = decodeURIComponent(entry.url.pathname.slice(root.pathname.length));
      files.push({
        location: webdavLocation(entry.url),
        relPath,
        name: relPath.split('/').pop() ?? relPath,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        uri: entry.url.href,
      });
    }
  }
  return files;
}

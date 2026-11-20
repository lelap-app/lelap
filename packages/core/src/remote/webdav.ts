import type { ListedFile } from '../library/scan';
import { asArray, isNode, parseXml, textOf } from '../podcasts/xml';
import { rebaseUri } from './addresses';
import { basicAuth, failure, type Fetch, fetchText } from './http';

export type WebdavSource = { url: string; username: string; password: string };

const MAX_FOLDERS = 5_000;

// Per folder: generous for a slow server, short enough that a dead one fails visibly.
const FOLDER_TIMEOUT_MS = 30_000;
const WHAT = 'WebDAV server';

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
export async function parseMultistatus(xml: string, folder: URL): Promise<Entry[]> {
  const doc = await parseXml(xml);
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

type Options = { timeoutMs?: number };
type ListOptions = Options & {
  /**
   * The server's own address when `source.url` is its other one (M146): files are named and
   * stored by their place at the own address, whichever address listed them.
   */
  nameAt?: string;
};

const listingHeaders = (source: WebdavSource) => ({
  ...webdavHeaders(source),
  Depth: '1',
  'Content-Type': 'application/xml',
});

async function readFolder(fetcher: Fetch, source: WebdavSource, folder: URL, timeoutMs: number) {
  const { response, text } = await fetchText(
    fetcher,
    folder.href,
    { method: 'PROPFIND', headers: listingHeaders(source), body: PROPFIND_BODY },
    WHAT,
    timeoutMs,
  );
  if (response.status !== 207 && !response.ok) throw failure(response.status, WHAT);
  return parseMultistatus(text, folder);
}

/**
 * Checks the address and the login by reading only the folder entered, so a large server
 * answers as fast as a small one. The full walk is the scan's job.
 */
export async function checkWebdav(
  fetcher: Fetch,
  source: WebdavSource,
  { timeoutMs = FOLDER_TIMEOUT_MS }: Options = {},
): Promise<{ folders: number; files: number }> {
  const entries = await readFolder(fetcher, source, webdavRoot(source.url), timeoutMs);
  const folders = entries.filter((e) => e.folder).length;
  return { folders, files: entries.length - folders };
}

/**
 * Every file below the server folder, walked one level at a time (many servers refuse
 * `Depth: infinity`). The same shape as a folder on the phone, so the same rules make books.
 */
export async function listWebdav(
  fetcher: Fetch,
  source: WebdavSource,
  { timeoutMs = FOLDER_TIMEOUT_MS, nameAt }: ListOptions = {},
): Promise<ListedFile[]> {
  const root = webdavRoot(source.url);
  const named = (url: URL): URL => {
    if (!nameAt) return url;
    const moved = rebaseUri(url.href, root.href, webdavRoot(nameAt).href);
    // Named by the other address, a file would be a new book: the scan fails and changes nothing.
    if (!moved) throw new Error(`${url.href} is not below ${root.href}.`);
    return new URL(moved);
  };
  const files: ListedFile[] = [];
  const queue: URL[] = [root];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const folder = queue.shift() as URL;
    if (seen.has(folder.href) || seen.size >= MAX_FOLDERS) continue;
    seen.add(folder.href);
    for (const entry of await readFolder(fetcher, source, folder, timeoutMs)) {
      if (entry.folder) {
        const url = entry.url;
        queue.push(url.pathname.endsWith('/') ? url : new URL(`${url.origin}${url.pathname}/`));
        continue;
      }
      const relPath = decodeURIComponent(entry.url.pathname.slice(root.pathname.length));
      const url = named(entry.url);
      files.push({
        location: webdavLocation(url),
        relPath,
        name: relPath.split('/').pop() ?? relPath,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        uri: url.href,
      });
    }
  }
  return files;
}

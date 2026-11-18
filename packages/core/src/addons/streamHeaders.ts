import type { RequestHeaders } from '@lelap/sdk';
import { eq } from 'drizzle-orm';

import type { Db } from '../db';
import { headersFor } from '../remote/addon';
import { books, streamHeaders } from '../schema';
import { secretBox } from '../secrets';
import { isLocalAddonUrl } from './local';

// Headers a stream from an add-on inside the app asked for (M57), such as a login. Sealed in a
// table of their own, which sync, exports and diagnostics never read.

type Tx = Pick<Db, 'insert' | 'delete'>;

/**
 * Keeps a streamed book's headers, or forgets them. Only an add-on inside the app may set any;
 * a web add-on's headers are refused before they get here, and dropped here too.
 */
export function saveStreamHeaders(
  db: Tx,
  bookId: string,
  addonUrl: string,
  headers: RequestHeaders | undefined,
  now: number,
): void {
  if (!headers || Object.keys(headers).length === 0 || !isLocalAddonUrl(addonUrl)) {
    db.delete(streamHeaders).where(eq(streamHeaders.bookId, bookId)).run();
    return;
  }
  const set = {
    addonUrl,
    headers: secretBox().seal(JSON.stringify(headers)),
    updatedAt: now,
  };
  db.insert(streamHeaders)
    .values({ bookId, ...set })
    .onConflictDoUpdate({ target: streamHeaders.bookId, set })
    .run();
}

/** Forgets every login an add-on's streams asked for, such as when another file takes its place. */
export function forgetStreamHeaders(db: Db, addonUrl: string): void {
  db.delete(streamHeaders).where(eq(streamHeaders.addonUrl, addonUrl)).run();
}

/**
 * The headers to send with a request for one of a streamed book's files: those its add-on asked
 * for, and only when the request goes to one of that add-on's hosts. `hostsOf` gives an add-on's
 * hosts, or null when it is no longer on this device.
 */
export function streamHeadersFor(
  db: Db,
  bookId: string,
  url: string,
  hostsOf: (addonUrl: string) => string[] | null,
): Record<string, string> {
  const row = db.select().from(streamHeaders).where(eq(streamHeaders.bookId, bookId)).get();
  if (!row || !isLocalAddonUrl(row.addonUrl)) return {};
  // The book now plays from another add-on: these were never meant for it.
  const book = db
    .select({ addonItem: books.addonItem })
    .from(books)
    .where(eq(books.id, bookId))
    .get();
  if (book?.addonItem?.addonUrl !== row.addonUrl) return {};
  const hosts = hostsOf(row.addonUrl);
  if (!hosts) return {};
  const opened = secretBox().open(row.headers);
  if (opened === null) return {};
  let headers: Record<string, string>;
  try {
    headers = JSON.parse(opened) as Record<string, string>;
  } catch {
    return {};
  }
  return headersFor(url, headers, hosts);
}

import type { Db } from '../db';
import { isPlaceholderFeed } from './placeholder';
import { listSubscriptions } from './repository';

/**
 * Fetches every subscribed feed of a profile, a few at a time: 500 feeds at once would crowd out
 * the app's own start and the network. One failing feed never stops the others.
 */
export async function refreshFeeds(
  db: Db,
  profileId: string,
  fetchFeed: (feedUrl: string) => Promise<unknown>,
  atOnce = 6,
): Promise<void> {
  const feeds = listSubscriptions(db, profileId)
    .map((s) => s.feedUrl)
    .filter((url) => !isPlaceholderFeed(url));
  const worker = async () => {
    for (let feed = feeds.shift(); feed !== undefined; feed = feeds.shift()) {
      await fetchFeed(feed).catch(() => null);
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
}

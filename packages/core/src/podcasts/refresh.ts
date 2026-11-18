import type { Db } from '../db';
import { isPlaceholderFeed } from './placeholder';
import { listSubscriptions } from './repository';

/** What a refresh did: how many feeds it asked, and which failed with what. */
export type RefreshResult = {
  feeds: number;
  failures: { podcastId: string; error: unknown }[];
};

/**
 * Fetches every subscribed feed of a profile, a few at a time: 500 feeds at once would crowd out
 * the app's own start and the network. One failing feed never stops the others.
 */
export async function refreshFeeds(
  db: Db,
  profileId: string,
  fetchFeed: (feedUrl: string) => Promise<unknown>,
  atOnce = 6,
): Promise<RefreshResult> {
  const feeds = listSubscriptions(db, profileId).filter((s) => !isPlaceholderFeed(s.feedUrl));
  const result: RefreshResult = { feeds: feeds.length, failures: [] };
  const worker = async () => {
    for (let feed = feeds.shift(); feed !== undefined; feed = feeds.shift()) {
      const { podcastId } = feed;
      await fetchFeed(feed.feedUrl).catch((error: unknown) => {
        result.failures.push({ podcastId, error });
      });
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
  return result;
}

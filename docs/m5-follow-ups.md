# M5 follow-ups

What is left of [M5 Podcasts](roadmap.md#m5-podcasts) after PR #15. Built and unit-tested
without a phone; nothing below has run yet.

## 1. Device checks

Steps are in [`apps/app/README.md`](../apps/app/README.md#m5-device-checklist).

| #   | Check                                                                   | Status  |
| --- | ----------------------------------------------------------------------- | ------- |
| 1   | **Done-when:** both podcast folders become subscriptions, place carried | Not run |
| 2   | A podcast from Search opens, reads its feed and subscribes              | Not run |
| 3   | Subscribe by pasting a feed address                                     | Not run |
| 4   | OPML export then import adds nothing twice                              | Not run |
| 5   | Auto-download keeps the newest N and removes played ones                | Not run |
| 6   | Up Next: an episode hands over, a book stops                            | Not run |
| 7   | Pull to refresh fetches new episodes; unchanged feeds answer 304        | Not run |

Podcast search needs `PODCASTINDEX_KEY` and `PODCASTINDEX_SECRET` on the catalog Worker
([M3 follow-ups](m3-follow-ups.md)). Without them, use “paste its feed address” in check 1.

## 2. Known limits

- Up Next hands over only while the app's JavaScript runs; with the app swiped away the service
  stops at the end of an episode. Fix: give the playback service the queue.
- Feeds refresh and auto-downloads start only when the app opens. Fix: a periodic WorkManager job.
- Atom feeds are not read.
- Unsubscribing keeps the podcast's episodes and their places (subscribing again picks them up),
  so episode books of unsubscribed podcasts stay in the database.

# M5 Podcasts: design

Status: builder's design, written with the code. Milestone: [M5 in the roadmap](../../milestones/m5.md).

**Done when** the maintainer's own podcast subscriptions have moved over. They live as two
folders of episodes on the phone, which M2 scans as books, so a folder must be able to become a
subscription and keep its place.

## Decisions (the maintainer's picks)

- **Auto-download is off by default**, opted into per podcast; it then keeps the newest N
  unplayed episodes (1, 3, 5 or 10) under M4's Wi-Fi and charging rules, and removes played ones.
- **Up Next:** when a podcast episode ends it is marked played, leaves the queue, and the first
  item in Up Next plays. When a book ends it is marked finished and playback stops.
- **Moving over from folders:** long-press the folder in the Library → “This is a podcast…”,
  find the podcast (Search through the Catalog add-on, or paste the feed), subscribe.

## Builder's calls

- **Feeds are read by the phone**, with `If-None-Match`/`If-Modified-Since`, on start, on return
  to the foreground (at most every 30 minutes) and on pull to refresh. No server polls feeds.
  `fast-xml-parser` reads RSS and OPML with entity processing off.
- **Episodes are books.** An episode gets a `books` row (`source = 'feed'`) the first time it is
  played, downloaded or queued, so places, the journal, bookmarks, downloads and Up Next work
  unchanged. Episode books stay out of the Library list; podcasts have their own tab.
- **The protocol's `Meta` gains `feed`**, the RSS address, which the Catalog add-on fills from
  Podcast Index. A podcast found in Search opens a podcast page that reads the feed itself.
- **Folder matching:** files pair with episodes by `S01E03`/`E03` against `itunes:season` and
  `itunes:episode`, then by title. Files before the one being listened to are played; that one's
  position carries over. The folder stays in the Library.
- **OPML** import through the document picker (`expo-document-picker`), export through the share
  sheet.

## Data (migration `0004_podcasts`)

Shared: `podcasts` (feed URL, guid, title, cover, ETag), `episodes` (guid per podcast, enclosure,
season and number, `book_id`). Per profile: `subscriptions` (auto-download, keep latest),
`up_next` (book, position).

## Limits

- Up Next continues only while the app's JavaScript runs. With the app swiped away, an episode
  that ends stops the service. Moving the queue into the playback service is a follow-up.
- Feeds refresh and auto-downloads start only when the app opens; a periodic background refresh
  (WorkManager) is a follow-up.
- Atom feeds are not read; podcasts use RSS.

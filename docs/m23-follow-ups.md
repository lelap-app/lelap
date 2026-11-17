# M23 follow-ups

What is left of M23 Podcasting 2.0 ([`next.md`](next.md)) after its first pull request. M23 stays
“In progress” until the device checks pass.

## What landed

- `parseFeed` reads `podcast:chapters`, `podcast:transcript`, `podcast:person` (show and episode),
  `podcast:season` (number and name), `podcast:episode`, `podcast:funding` and `podcast:guid`.
  Addresses that are not http(s) are dropped. `itunes:season` and `itunes:episode` still win.
- Migration `0009_podcasting` adds one nullable JSON column, `extras`, to `podcasts` and `episodes`.
  A feed stored before it is fetched once without its ETag, so the fields fill in.
- Chapters: an episode whose audio has no chapters gets its chapters file (`toc: false` entries are
  skipped) when it starts playing. Playing from the podcast page waits up to 2.5 s for it, so the
  playback service starts with the chapters; from elsewhere they appear in the player when they
  arrive and reach the service on the next load. Chapters are never guessed from silence.
- Transcript: a Transcript tool in the player for episodes that list one. JSON is preferred, then
  WebVTT, SRT, HTML and plain text. Short caption lines and word-level JSON are joined into
  sentences; the current line is lit and the list follows it (paused for 8 s after a scroll), and a
  tap seeks. Untimed transcripts show as text.
- Podcast page: hosts and guests (a tap opens their page), season headings when a feed has two or
  more seasons, guests in each episode's line, and “Support this show” links that open the browser.
- Proxy: `GET /text?url=` passes UTF-8 text (refusing media types, binary bodies and anything over
  5 MB) as `text/plain`, cached for a day. Audio still never goes through it.

## 1. Device checks

Not run (no phone testing for now). Checked in the web preview with the Podcasting 2.0 feed
(`https://feeds.podcastindex.org/pc20.xml`): people, the support link, 38 chapters from the chapters
file, the SRT transcript following along and seeking on tap.

| #   | Check                                                                                        | Status  |
| --- | -------------------------------------------------------------------------------------------- | ------- |
| 1   | Playing a Podcasting 2.0 episode from the podcast page starts with its chapters in the sheet | Not run |
| 2   | Notification and lock screen chapter skip use the fetched chapters after the first load      | Not run |
| 3   | A downloaded episode with embedded chapters keeps them; the chapters file is not used        | Not run |
| 4   | Transcript follows along with the screen on, and seeking from a line works while paused      | Not run |
| 5   | “Support this show” and a person's link open the browser                                     | Not run |
| 6   | A feed subscribed before this update gets people and funding after the next refresh          | Not run |

## 2. Open points

- Transcripts are cached for the session in memory (and for a day by the proxy on the web); they
  are not kept offline with a downloaded episode. Storing them with downloads is a follow-up.
- `podcast:soundbite`, `podcast:location`, `podcast:value` and alternate enclosures are not read.

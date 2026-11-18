# M60 follow-ups

Checked in the web preview (Chrome), with the catalog Worker and the feed proxy under
`wrangler dev` and the add-on added by its manifest URL: Home and Discover show “Old-time radio”,
“Lectures and talks” and “Readings and poetry” with covers and ratings. Searching “dragnet” finds
five Dragnet items under Internet Archive. “Dragnet the 50's radio show” opens as a podcast whose
feed comes from the add-on through the proxy: 298 episodes, newest first, dated by their broadcast
dates (20/09/1955 at the top). An episode played for 10 s from archive.org. A lecture
(“Kierkegaard and the Crisis in Religion”) opens as an audiobook: 1 h 21 min in two parts, 39 MB to
download.

Covered by tests, against archive.org answers recorded with a handful of requests
(`services/catalog/test/fixtures/ia-*.json`, trimmed, without uploader addresses): the licence
rule case by case (public-domain tools, the six Creative Commons licences, sampling licences,
other hosts, `NOT_IN_COPYRIGHT`, lending-library items, an old-time radio item without a licence),
search results the filter lets through dropped again, the queries archive.org gets (scope, rule,
LibriVox left out, input escaped), meta for a radio series and a lecture, streams with the 64 kb
copy of each recording, a series with mixed bitrates, the RSS feed (enclosures only on
archive.org, broadcast dates, file order when names have no date), 404s for unlicensed, unknown and
malformed identifiers, and the mount on the Worker.

Open on a phone:

- <a id="add"></a>Settings → Add-ons → paste `https://catalog.lelap.app/internet-archive/manifest.json`
  (after the next services deploy). It shows as Working; Home gets the three rows.
- <a id="radio"></a>Search “dragnet”, open “Dragnet the 50's radio show”, Subscribe. It shows in
  Podcasts with 298 episodes; play one with the screen off, it streams from archive.org.
- <a id="download"></a>Download an episode of the radio series on Wi-Fi; it plays in flight mode.
- <a id="lecture"></a>Open a lecture from “Lectures and talks” with several parts: Play goes from
  the first part to the second without a gap in the place, and the chapters list the parts.

Elsewhere:

- <a id="deploy"></a>After the services deploy:
  `curl https://catalog.lelap.app/internet-archive/manifest.json` answers the manifest, and
  `curl -I https://catalog.lelap.app/internet-archive/feed/Dragnet_OTR.xml` answers
  `application/rss+xml`.
- <a id="docker"></a>The catalog Docker image answers `/internet-archive/manifest.json` and a feed.

## Review findings left for later

- <a id="labels"></a>The licence rule trusts archive.org's rights fields. Old-time radio uploaders
  often mark broadcasts as public domain that may not be: in the US, sound recordings from 1947 to
  1956 stay protected until about 2067 under the Music Modernization Act. Decided: the rule stays
  as built (see Decisions in [`brief.md`](brief.md)).
- Copies of one recording uploaded separately (a 128 kb and a 64 kb MP3, both originals) show as
  two recordings; a name-stem match would merge them.
- Broadcast dates in file names are read as 19yy; a recreation from the 2000s with dates in its
  file names would be dated a century early.

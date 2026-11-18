# M56 follow-ups

Not checked in the web preview: the web app has no phone folder, and a work page with a library
book needs a WebDAV or Audiobookshelf server the preview can reach. Covered by tests: the
matcher's normalising and scoring with the false matches the review found (series subtitles,
“Dune - Part Two”, Stephen and Owen King, “Harry Potter, Book 2”, folder names like
“02 - Dune”), ISBN-10 and ISBN-13, ISBN and ASIN tags in ID3 `TXXX` frames and MP4 freeform items
(Kotlin unit tests), Audiobookshelf and Jellyfin IDs, links and “not this one” across pages of
one work, links syncing keyed on the book's location before and after the other device scans,
the Match with catalog… title, author and cover in the Library, a test that matching makes no
request and names no network API, and the sample source add-on answering an ISBN without a
request and an `ol:` work by title and author.

## Open on a phone

- <a id="offer"></a>A book on a WebDAV server, tagged “Dune” by Frank Herbert under a folder
  named `hb-01`: Discover → Dune shows “In your library?”; “Yes, use my copy” lists “Your copy”
  first, selected, and Play plays the WebDAV files from the library book's place.
- <a id="isbn"></a>A book whose files carry an ISBN or ASIN tag (or an Audiobookshelf book with
  ISBN or ASIN set): its Catalog page shows “Your copy” without asking.
- <a id="rescan"></a>After the update, the first scan of an existing phone folder or WebDAV
  library reads every file's tags once more (for ISBN and ASIN). Check it finishes on a big
  library and that the second scan reads nothing.
- <a id="manual"></a>Library → hold a book that matches nothing → Match with catalog… → search,
  pick: the book shows the work's title, author and cover; its Catalog page plays it. “Unlink
  from catalog” brings its own title back.
- <a id="unlink"></a>On a work page, “Not your copy? Unlink”: the page goes back to add-on
  sources and doesn't offer the book again; the same on the work's Audnexus (`asin:`) page.
- <a id="sync"></a>With sync on, a link made on one phone shows on the other's work page once
  both scanned the same server.
- <a id="talkback"></a>TalkBack reads the “In your library?” card and its two buttons, and the
  “Your copy” source as a radio button with its state.

## Minor review findings, not fixed here

- The page always starts on “Your copy”, even when the listener picked an add-on's source for
  that work last time. This follows “your copy first”; say if the remembered choice should win.
- A leading “Book 2 - Title” is not read as a series number; “02 - Title” is.
- A print ASIN that equals the ISBN-10 does not meet `isbn:978…`; only a missed match.
- The Library sorts and searches by the files' title, not the title from Match with catalog….
- ID3 v2.2 (`TXX`), unsynchronised ID3 tags and Audible's own m4b ASIN atom are not read.
- After Match with catalog… the Library loads the cover from the catalog's cover host; it isn't
  saved on the phone like embedded covers.
- `linkedMetaByKey` reads the linked rows on every Library list and book read; small, through the
  state index.

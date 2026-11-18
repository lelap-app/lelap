---
'@lelap/sdk': minor
---

The matcher Lelap uses to find a book page's work in the listener's own library, for source
add-ons to map their files to works. `createWorkIndex(entries)` indexes your items by ID, title
and author; `find(work)` returns those that share an ISBN, ASIN or other ID, else those with the
same title and author after normalising (case, accents, punctuation, a leading article,
“(Unabridged)”, series numbers, “Last, First”). `matchStrength`, `titleKey`, `authorKey`,
`sameAuthor`, `sameAuthors`, `splitAuthors`, `fold`, `normalizeId`, `normalizeIds`,
`normalizeIsbn` and `idsFromTags` are the pieces. `lookupWork(id)` turns a work ID into what the
index needs: `isbn:` and `asin:` as they are, an `ol:` work's title, authors and edition IDs from
Open Library. No change to the protocol.

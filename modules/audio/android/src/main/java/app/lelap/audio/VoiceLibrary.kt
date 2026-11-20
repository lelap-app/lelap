package app.lelap.audio

/** What a voice request resolved to on the phone, before any add-on is asked. */
data class VoiceAnswer(
  val request: VoiceRequest,
  val local: List<VoiceMatch>,
  /** Ask the add-ons too: the phone has no clear match, and the request names a title. */
  val askAddons: Boolean,
)

/**
 * Voice search over what is on the phone (M147): the car snapshot's shelves and lists, the
 * library beyond them and the journal's book, each book once. It needs no network.
 */
object VoiceLibrary {
  /** A book found by voice: `search/<bookId>`, played on its own like a book picked in the car. */
  const val PREFIX = "search/"

  fun answer(query: String?, title: String?, artist: String?, snapshot: CarSnapshot, journal: BookLoad?): VoiceAnswer {
    val request = VoiceQuery.parse(query, title, artist)
    val candidates = candidates(snapshot, journal)
    return when (request) {
      VoiceRequest.Resume -> VoiceAnswer(request, listOfNotNull(resume(snapshot, journal)), askAddons = false)
      is VoiceRequest.Latest -> {
        // The Podcasts shelf holds each show's newest unfinished episode; an older one half played
        // elsewhere must not win on its place.
        val newest = snapshot.podcasts.map { candidate(it, snapshot) }
        val latest = VoiceSearch.latest(request, newest).ifEmpty { VoiceSearch.latest(request, candidates) }
        // A show not followed, or none of its episodes left: maybe an episode's own title.
        val local = latest.ifEmpty { VoiceSearch.rank(VoiceRequest.Find(request.show, kind = VoiceKind.EPISODE), candidates) }
        VoiceAnswer(request, local, askAddons = false)
      }
      is VoiceRequest.Find -> {
        val local = VoiceSearch.rank(request, candidates)
        // Add-ons have books, not the listener's episodes.
        VoiceAnswer(request, local, askAddons = request.kind != VoiceKind.EPISODE && !VoiceSearch.isClear(local))
      }
    }
  }

  /** The text add-ons are asked with: a title, or a title and author as spoken. */
  fun addonQuery(request: VoiceRequest): String? = (request as? VoiceRequest.Find)?.text?.takeIf { it.isNotBlank() }

  /** What “resume my book” plays: the journal's book, else the first of Continue listening. */
  fun resume(snapshot: CarSnapshot, journal: BookLoad?): VoiceMatch? {
    val load = journal ?: snapshot.continueListening.firstOrNull() ?: return null
    return VoiceMatch(candidate(load, snapshot), 100)
  }

  fun candidates(snapshot: CarSnapshot, journal: BookLoad?): List<VoiceCandidate> =
    loads(snapshot, journal).map { candidate(it, snapshot) }

  /** The book behind a `search/` media ID, at the newer of the journal's place and the app's. */
  fun resolve(mediaId: String, snapshot: CarSnapshot, journal: BookLoad?): BookLoad? {
    if (!mediaId.startsWith(PREFIX)) return null
    val bookId = mediaId.removePrefix(PREFIX)
    val listed = loads(snapshot, null).firstOrNull { it.playlist.bookId == bookId }
    val journaled = journal?.takeIf { it.playlist.bookId == bookId }
    if (journaled == null) return listed
    if (listed == null) return journaled
    return if ((journaled.pausedAt ?: 0L) >= (listed.pausedAt ?: 0L)) journaled.copy(handsOver = listed.handsOver) else listed
  }

  // Shelves first, where a book loads as the car loads it; a list's copy plays on its own here.
  private fun loads(snapshot: CarSnapshot, journal: BookLoad?): List<BookLoad> =
    (
      listOfNotNull(journal) + snapshot.continueListening + snapshot.onPhone + snapshot.podcasts + snapshot.upNext +
        snapshot.library + snapshot.lists.flatMap { list -> list.items.map { it.copy(handsOver = false) } }
      ).distinctBy { it.playlist.bookId }

  private fun candidate(load: BookLoad, snapshot: CarSnapshot): VoiceCandidate {
    val playlist = load.playlist
    val episode = playlist.bookId in snapshot.episodes || snapshot.podcasts.any { it.playlist.bookId == playlist.bookId }
    return VoiceCandidate(
      id = PREFIX + playlist.bookId,
      title = playlist.title,
      author = playlist.author,
      kind = if (episode) VoiceKind.EPISODE else VoiceKind.BOOK,
      local = true,
      pausedAt = load.pausedAt,
      artworkUri = playlist.coverUri,
    )
  }
}

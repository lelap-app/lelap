package app.lelap.audio

import app.lelap.text.NativeCatalog
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** What the app last listed for the car, as playable books. Written whenever the library changes. */
data class CarSnapshot(
  val continueListening: List<BookLoad> = emptyList(),
  val onPhone: List<BookLoad> = emptyList(),
  val podcasts: List<BookLoad> = emptyList(),
  val upNext: List<BookLoad> = emptyList(),
)

/** One row in Android Auto's browser, before it becomes a Media3 `MediaItem`. */
data class CarNode(
  val id: String,
  val title: String,
  val subtitle: String? = null,
  val artworkUri: String? = null,
  val browsable: Boolean,
  val playable: Boolean,
)

/**
 * The browse tree Android Auto shows. It is built from the app's snapshot and the service's own
 * journal only, so it works with the app closed.
 */
object CarLibrary {
  const val ROOT = "root"
  const val CONTINUE = "continue"
  const val ON_PHONE = "phone"
  const val PODCASTS = "podcasts"
  const val UP_NEXT = "upnext"

  private val SHELVES = listOf(CONTINUE, ON_PHONE, PODCASTS, UP_NEXT)

  private fun shelfTitle(id: String, text: NativeCatalog): String = when (id) {
    CONTINUE -> text.t("Continue listening")
    ON_PHONE -> text.t("On this phone")
    PODCASTS -> text.t("Podcasts")
    else -> text.t("Up Next")
  }

  private fun shelfNode(id: String, text: NativeCatalog) =
    CarNode(id, shelfTitle(id, text), browsable = true, playable = false)

  fun root(): CarNode = CarNode(ROOT, "Lelap", browsable = true, playable = false)

  /**
   * The children of [parentId], or null when there is no such node. Shelf names are in [text]'s
   * language; covers on the phone go through [CoverProvider] at [coverAuthority], else are left out.
   */
  fun children(
    parentId: String,
    snapshot: CarSnapshot,
    journal: BookLoad?,
    text: NativeCatalog = NativeCatalog.ENGLISH,
    coverAuthority: String? = null,
  ): List<CarNode>? = when (parentId) {
    ROOT -> SHELVES.map { shelfNode(it, text) }
    else -> shelf(parentId, snapshot, journal)?.map { bookNode(parentId, it.playlist, coverAuthority) }
  }

  /** The node for [mediaId], for controllers that ask for one item. */
  fun item(
    mediaId: String,
    snapshot: CarSnapshot,
    journal: BookLoad?,
    text: NativeCatalog = NativeCatalog.ENGLISH,
    coverAuthority: String? = null,
  ): CarNode? {
    if (mediaId == ROOT) return root()
    if (mediaId in SHELVES) return shelfNode(mediaId, text)
    val (shelfId, bookId) = split(mediaId) ?: return null
    return shelf(shelfId, snapshot, journal)?.firstOrNull { it.playlist.bookId == bookId }
      ?.let { bookNode(shelfId, it.playlist, coverAuthority) }
  }

  /**
   * What to load for a book picked in the car: the newer of the journal's place and the app's,
   * since the service may have played it since the app last wrote the snapshot.
   */
  fun resolve(mediaId: String, snapshot: CarSnapshot, journal: BookLoad?): BookLoad? {
    val (shelfId, bookId) = split(mediaId) ?: return null
    // Other controllers send file locations, which may contain slashes too.
    if (shelfId !in SHELVES) return null
    val listed = sequenceOf(snapshot.continueListening, snapshot.onPhone, snapshot.podcasts, snapshot.upNext)
      .flatten()
      .firstOrNull { it.playlist.bookId == bookId }
    val journaled = journal?.takeIf { it.playlist.bookId == bookId }
    if (journaled == null) return listed
    if (listed == null) return journaled
    return if ((journaled.pausedAt ?: 0L) >= (listed.pausedAt ?: 0L)) journaled.copy(handsOver = listed.handsOver) else listed
  }

  /** The journal's book at its saved place, ready to load. */
  fun journalLoad(entry: JournalEntry, playlist: BookPlaylist): BookLoad? {
    val index = playlist.files.indexOfFirst { it.location == entry.fileLocation }
    if (index < 0) return null
    return BookLoad(playlist, index, entry.filePositionMs, pausedAt = entry.savedAt)
  }

  fun decode(json: String?): CarSnapshot = try {
    val root = JSONObject(json ?: "{}")
    CarSnapshot(
      continueListening = UpNext.decodeQueue(root.optJSONArray("continueListening")?.toString()),
      onPhone = UpNext.decodeQueue(root.optJSONArray("onPhone")?.toString()),
      podcasts = UpNext.decodeQueue(root.optJSONArray("podcasts")?.toString()),
      upNext = UpNext.decodeQueue(root.optJSONArray("upNext")?.toString()),
    )
  } catch (e: JSONException) {
    CarSnapshot()
  }

  fun encode(snapshot: CarSnapshot): String = JSONObject()
    .put("continueListening", loads(snapshot.continueListening))
    .put("onPhone", loads(snapshot.onPhone))
    .put("podcasts", loads(snapshot.podcasts))
    .put("upNext", loads(snapshot.upNext))
    .toString()

  private fun loads(list: List<BookLoad>) = JSONArray(list.map { JSONObject(PositionJournal.encodeLoad(it)) })

  private fun shelf(id: String, snapshot: CarSnapshot, journal: BookLoad?): List<BookLoad>? = when (id) {
    // The journal's book is the one the service played last, maybe after the snapshot was written.
    CONTINUE -> listOfNotNull(journal) + snapshot.continueListening.filter { it.playlist.bookId != journal?.playlist?.bookId }
    ON_PHONE -> snapshot.onPhone
    PODCASTS -> snapshot.podcasts
    UP_NEXT -> snapshot.upNext
    else -> null
  }

  private fun bookNode(shelfId: String, playlist: BookPlaylist, coverAuthority: String?) = CarNode(
    id = "$shelfId/${playlist.bookId}",
    title = playlist.title,
    subtitle = playlist.author,
    artworkUri = CarCovers.artworkUri(playlist.coverUri, coverAuthority),
    browsable = false,
    playable = true,
  )

  private fun split(mediaId: String): Pair<String, String>? {
    val slash = mediaId.indexOf('/')
    if (slash <= 0 || slash == mediaId.lastIndex) return null
    return mediaId.substring(0, slash) to mediaId.substring(slash + 1)
  }
}

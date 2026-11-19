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
  val lists: List<CarList> = emptyList(),
)

/**
 * A list in the Lists shelf (M119): a window of its items in play order, finished ones only when
 * the list keeps them (those load from their start), and where Play list starts.
 */
data class CarList(
  val id: String,
  val title: String,
  val keepsFinished: Boolean,
  /** A smart list's order, handed back to the app so it follows the list as the car started it. */
  val order: List<String>?,
  val start: String?,
  val items: List<BookLoad>,
)

/** A list item picked in the car: what plays, and the list's items after and before it. */
data class CarListStart(
  val list: CarList,
  val load: BookLoad,
  val after: List<BookLoad>,
  /** Nearest first. */
  val before: List<BookLoad>,
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
  const val LISTS = "lists"

  /** A list's node is `list:<id>`, its items `list:<id>/<book>`; Play list is `listplay:<id>/<book>`. */
  const val LIST_PREFIX = "list:"
  const val PLAY_PREFIX = "listplay:"

  private val SHELVES = listOf(CONTINUE, ON_PHONE, PODCASTS, UP_NEXT, LISTS)

  private fun shelfTitle(id: String, text: NativeCatalog): String = when (id) {
    CONTINUE -> text.t("Continue listening")
    ON_PHONE -> text.t("On this phone")
    PODCASTS -> text.t("Podcasts")
    LISTS -> text.t("Lists")
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
    LISTS -> snapshot.lists.map(::listNode)
    else -> listAt(parentId, snapshot)?.let { listChildren(it, text, coverAuthority) }
      ?: shelf(parentId, snapshot, journal)?.map { bookNode(parentId, it.playlist, coverAuthority) }
  }

  /** The list nodes to tell Android Auto about when the snapshot changes. */
  fun listIds(snapshot: CarSnapshot): List<String> = snapshot.lists.map { LIST_PREFIX + it.id }

  private fun listAt(nodeId: String, snapshot: CarSnapshot): CarList? =
    if (!nodeId.startsWith(LIST_PREFIX)) null else snapshot.lists.firstOrNull { LIST_PREFIX + it.id == nodeId }

  private fun listNode(list: CarList) = CarNode(LIST_PREFIX + list.id, list.title, browsable = true, playable = false)

  /** Play list first, starting where the list stands, then its items to start from. */
  private fun listChildren(list: CarList, text: NativeCatalog, coverAuthority: String?): List<CarNode> {
    val start = list.items.firstOrNull { it.playlist.bookId == list.start }?.playlist
    val play = start?.let {
      CarNode(
        id = "$PLAY_PREFIX${list.id}/${it.bookId}",
        title = text.t("Play list"),
        subtitle = it.title,
        artworkUri = CarCovers.artworkUri(it.coverUri, coverAuthority),
        browsable = false,
        playable = true,
      )
    }
    return listOfNotNull(play) + list.items.map { bookNode(LIST_PREFIX + list.id, it.playlist, coverAuthority) }
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
    listAt(mediaId, snapshot)?.let { return listNode(it) }
    val (shelfId, bookId) = split(mediaId) ?: return null
    val list = if (shelfId.startsWith(PLAY_PREFIX)) listAt(LIST_PREFIX + shelfId.removePrefix(PLAY_PREFIX), snapshot) else listAt(shelfId, snapshot)
    if (list != null) {
      return listChildren(list, text, coverAuthority).firstOrNull { it.id == mediaId }
    }
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

  /**
   * A list's item or Play list picked in the car (M119), with the list around it; null for
   * anything else. The journal's place wins when newer, as in [resolve].
   */
  fun resolveList(mediaId: String, snapshot: CarSnapshot, journal: BookLoad?): CarListStart? {
    val (shelfId, bookId) = split(mediaId) ?: return null
    val listId = when {
      shelfId.startsWith(PLAY_PREFIX) -> shelfId.removePrefix(PLAY_PREFIX)
      shelfId.startsWith(LIST_PREFIX) -> shelfId.removePrefix(LIST_PREFIX)
      else -> return null
    }
    val list = snapshot.lists.firstOrNull { it.id == listId } ?: return null
    val at = list.items.indexOfFirst { it.playlist.bookId == bookId }
    if (at < 0) return null
    val listed = list.items[at].copy(handsOver = true)
    val journaled = journal?.takeIf { it.playlist.bookId == bookId && (it.pausedAt ?: 0L) > (listed.pausedAt ?: 0L) }
    return CarListStart(
      list = list,
      load = journaled?.copy(handsOver = true) ?: listed,
      after = list.items.drop(at + 1).map { it.copy(handsOver = true) },
      before = list.items.take(at).reversed().map { it.copy(handsOver = true) },
    )
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
      lists = decodeLists(root.optJSONArray("lists")),
    )
  } catch (e: JSONException) {
    CarSnapshot()
  }

  fun encode(snapshot: CarSnapshot): String = JSONObject()
    .put("continueListening", loads(snapshot.continueListening))
    .put("onPhone", loads(snapshot.onPhone))
    .put("podcasts", loads(snapshot.podcasts))
    .put("upNext", loads(snapshot.upNext))
    .put("lists", JSONArray(snapshot.lists.map(::encodeList)))
    .toString()

  private fun encodeList(list: CarList) = JSONObject()
    .put("id", list.id)
    .put("title", list.title)
    .put("keepsFinished", list.keepsFinished)
    .put("order", list.order?.let { JSONArray(it) } ?: JSONObject.NULL)
    .put("start", list.start ?: JSONObject.NULL)
    .put("items", loads(list.items))

  // A list that can't be read is left out; the rest of the snapshot stays.
  private fun decodeLists(array: JSONArray?): List<CarList> = (0 until (array?.length() ?: 0)).mapNotNull { i ->
    try {
      val o = array!!.getJSONObject(i)
      val order = o.optJSONArray("order")
      CarList(
        id = o.getString("id"),
        title = o.optString("title"),
        keepsFinished = o.optBoolean("keepsFinished", false),
        order = order?.let { a -> List(a.length()) { a.getString(it) } },
        start = if (o.isNull("start")) null else o.optString("start").takeIf { it.isNotEmpty() },
        items = UpNext.decodeQueue(o.optJSONArray("items")?.toString()),
      )
    } catch (e: JSONException) {
      null
    }
  }

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

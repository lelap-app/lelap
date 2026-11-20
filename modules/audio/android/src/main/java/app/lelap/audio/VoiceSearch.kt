package app.lelap.audio

/** Something voice search can offer: a book or episode on the phone, or an add-on's catalog item. */
data class VoiceCandidate(
  /** The media ID the car plays it by. */
  val id: String,
  val title: String,
  /** A book's author, an episode's show. */
  val author: String?,
  val kind: VoiceKind,
  /** On the phone (the library, its downloads), as against an add-on's catalog. */
  val local: Boolean,
  /** When it was last played, for ties: the one the listener is in wins. */
  val pausedAt: Long? = null,
  val subtitle: String? = author,
  val artworkUri: String? = null,
)

data class VoiceMatch(val candidate: VoiceCandidate, val score: Int)

/**
 * Ranks what a spoken request could mean (M147). Scores run from 0 to 100; the library comes
 * before add-ons, books before episodes, and among equals the one played last.
 */
object VoiceSearch {
  /** Below this a candidate is not a match at all. */
  const val MATCH = 45

  /** A match this good, this far ahead of the next, plays without asking add-ons. */
  const val CLEAR = 85
  private const val CLEAR_LEAD = 10

  /** Books before episodes when a request doesn't say which. */
  private const val EPISODE_PENALTY = 5
  private const val WRONG_KIND_PENALTY = 30

  fun rank(request: VoiceRequest.Find, candidates: List<VoiceCandidate>): List<VoiceMatch> = candidates
    .map { VoiceMatch(it, score(request, it)) }
    .filter { it.score >= MATCH }
    .sortedWith(ORDER)

  /** The newest episode of [request]'s show: the shows' names are the episodes' authors. */
  fun latest(request: VoiceRequest.Latest, candidates: List<VoiceCandidate>): List<VoiceMatch> = candidates
    .filter { it.kind == VoiceKind.EPISODE && it.author != null }
    .map { VoiceMatch(it, titleScore(VoiceText.words(request.show), VoiceText.words(it.author!!))) }
    .filter { it.score >= MATCH }
    .sortedWith(ORDER)

  /** The library's matches, then the add-ons' ones, each in its own order. */
  fun merge(local: List<VoiceMatch>, addons: List<VoiceMatch>): List<VoiceMatch> {
    val known = local.map { VoiceText.normalize(it.candidate.title) to VoiceText.normalize(it.candidate.author.orEmpty()) }.toSet()
    // An add-on's copy of a book already in the library would only play a second copy.
    val fresh = addons.filter { (VoiceText.normalize(it.candidate.title) to VoiceText.normalize(it.candidate.author.orEmpty())) !in known }
    return local + fresh
  }

  /**
   * What a play request plays: a clear match on the phone, else the better of the phone's best
   * and the add-ons' best, the phone's on a tie. Several close matches still play the first:
   * Android Auto lists the rest from the same search.
   */
  fun choose(local: List<VoiceMatch>, addons: List<VoiceMatch>): VoiceMatch? {
    if (isClear(local)) return local.first()
    val mine = local.firstOrNull()
    val theirs = addons.firstOrNull() ?: return mine
    return if (mine != null && mine.score >= theirs.score) mine else theirs
  }

  /** One match stands out, so the request can play it at once. */
  fun isClear(matches: List<VoiceMatch>): Boolean {
    val top = matches.firstOrNull() ?: return false
    if (top.score < CLEAR) return false
    val next = matches.getOrNull(1) ?: return true
    return top.score - next.score >= CLEAR_LEAD
  }

  private val ORDER = compareByDescending<VoiceMatch> { it.candidate.local }
    .thenByDescending { it.score }
    .thenBy { it.candidate.kind }
    .thenByDescending { it.candidate.pausedAt ?: 0L }

  fun score(request: VoiceRequest.Find, candidate: VoiceCandidate): Int {
    val query = VoiceText.words(request.text)
    if (query.isEmpty()) return 0
    val title = VoiceText.words(candidate.title)
    val author = VoiceText.words(candidate.author.orEmpty())
    var best = titleScore(query, title)
    if (request.author != null) {
      val asked = VoiceText.words(request.author)
      val titlePart = VoiceText.words(request.text.removeSuffix(" by ${request.author}"))
      val byAuthor = titleScore(titlePart, title)
      if (byAuthor > 0 && covers(asked, author)) best = maxOf(best, minOf(100, byAuthor + 10))
      else if (byAuthor > 0) best = maxOf(best, byAuthor - 15)
    }
    // “Pride and Prejudice Jane Austen”: the title, then the author, in one breath.
    if (author.isNotEmpty() && query.size > title.size && query.take(title.size) == title &&
      covers(query.drop(title.size), author)
    ) {
      best = maxOf(best, 95)
    }
    // Only an author or show: every one of theirs matches, none clearly.
    if (author.isNotEmpty() && query == author) best = maxOf(best, 60)
    val kind = request.kind
    if (kind != null && kind != candidate.kind) best -= WRONG_KIND_PENALTY
    else if (kind == null && candidate.kind == VoiceKind.EPISODE) best -= EPISODE_PENALTY
    return best.coerceIn(0, 100)
  }

  /**
   * How well spoken words match a title. Whole: 100. The title's start (a subtitle or sequel left
   * unsaid): 80 to 84, so “Dune” stays clear of “Dune Messiah”. Otherwise by how many words are
   * shared, and only when most of what was said is in it.
   */
  fun titleScore(query: List<String>, title: List<String>): Int {
    if (query.isEmpty() || title.isEmpty()) return 0
    if (query == title) return 100
    if (title.size > query.size && title.take(query.size) == query) {
      return 88 - minOf(8, (title.size - query.size) * 4)
    }
    val titleWords = title.toSet()
    // A word said only in part (“hitchhiker” for “hitchhikers”) still counts.
    val matched = query.count { word -> word in titleWords || titleWords.any { it.startsWith(word) && word.length >= 4 } }
    val coverage = matched.toDouble() / query.size
    if (coverage < 0.6) return 0
    val precision = matched.toDouble() / title.size
    return (45 * coverage + 35 * precision).toInt()
  }

  // Every word asked for is in the author's name (“Austen” for “Jane Austen”).
  private fun covers(asked: List<String>, author: List<String>): Boolean =
    asked.isNotEmpty() && author.isNotEmpty() && asked.all { it in author }
}

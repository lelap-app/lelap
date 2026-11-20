package app.lelap.audio

import java.text.Normalizer

enum class VoiceKind { BOOK, EPISODE }

/** What a spoken request asks for (M147), once its filler words are gone. */
sealed interface VoiceRequest {
  /** “Resume my book”, “play Lelap” or no words at all: what was played last. */
  data object Resume : VoiceRequest

  /** “The latest episode of X”: the newest episode of the show [show]. */
  data class Latest(val show: String) : VoiceRequest

  /** A title, maybe with its author (“Dune by Frank Herbert”), maybe only books or episodes. */
  data class Find(val text: String, val author: String? = null, val kind: VoiceKind? = null) : VoiceRequest
}

/**
 * Reads what the Assistant or Android Auto hands over. The Assistant usually sends only the words
 * between “play” and “on Lelap”, but typed searches and other assistants send whole sentences.
 */
object VoiceQuery {
  private val LEADING = listOf("hey google", "ok google", "okay google", "please", "can you", "could you")
  private val VERBS = listOf("listen to", "put on", "start", "play", "resume", "continue", "carry on with", "go back to")
  private val RESUMING = setOf("resume", "continue", "carry on with", "go back to")
  private val APP = Regex("""\s+(on|in|from|with|using)\s+lelap$|^lelap$""")
  // Not “book” or “the book”: titles start and end with them (The Book Thief, The Jungle Book).
  private val BOOK_WORDS = listOf("the audiobook", "an audiobook", "audiobook", "the audio book", "audio book")
  private val EPISODE_WORDS = listOf("the podcast", "podcast")

  // Said instead of a title: the book or show already going.
  private val RESUME_PHRASES = setOf(
    "", "my book", "my audiobook", "my audio book", "my podcast", "my episode", "my last book",
    "the last book", "last book", "what i was listening to", "where i left off", "from where i left off",
    "it", "something", "my books", "listening", "playing", "playback", "music",
  )
  private val LATEST = Regex("""^(?:the\s+)?(?:latest|newest|new|most recent|last)\s+episode\s+(?:of|from)\s+(.+)$""")
  private val LATEST_SHORT = Regex("""^(?:the\s+)?(?:latest|newest)\s+(.+?)(?:\s+episode)?$""")

  /**
   * [title] and [artist] are the Assistant's own reading of the request, when it sends one
   * (`MediaStore.EXTRA_MEDIA_TITLE`, `EXTRA_MEDIA_ARTIST`); they win over our reading of [query].
   */
  fun parse(query: String?, title: String? = null, artist: String? = null): VoiceRequest {
    val given = VoiceText.normalize(title.orEmpty())
    if (given.isNotEmpty() && given !in RESUME_PHRASES) {
      return VoiceRequest.Find(given, VoiceText.normalize(artist.orEmpty()).ifEmpty { null })
    }
    var text = VoiceText.normalize(query.orEmpty())
    for (lead in LEADING) text = text.removeWord(lead)
    var resuming = false
    for (verb in VERBS) {
      val rest = text.removeWord(verb)
      if (rest != text) {
        resuming = verb in RESUMING
        text = rest
        break
      }
    }
    text = text.replace(APP, "").trim()
    if (text in RESUME_PHRASES || (resuming && text.startsWith("my "))) return VoiceRequest.Resume

    LATEST.find(text)?.let { return VoiceRequest.Latest(stripKind(it.groupValues[1]).first) }
    val (stripped, kind) = stripKind(text)
    if (stripped in RESUME_PHRASES) return VoiceRequest.Resume
    LATEST_SHORT.find(stripped)?.let { return VoiceRequest.Latest(it.groupValues[1]) }
    val by = stripped.lastIndexOf(" by ")
    return if (by > 0 && by + 4 < stripped.length) {
      VoiceRequest.Find(stripped, stripped.substring(by + 4), kind)
    } else {
      VoiceRequest.Find(stripped, null, kind)
    }
  }

  /** The request without “the audiobook” or “podcast”, and which of the two it asked for. */
  private fun stripKind(text: String): Pair<String, VoiceKind?> {
    for (word in BOOK_WORDS) {
      val rest = text.removeWord(word).removeTrailingWord(word)
      if (rest != text) return rest to VoiceKind.BOOK
    }
    for (word in EPISODE_WORDS) {
      val rest = text.removeWord(word).removeTrailingWord(word)
      if (rest != text) return rest to VoiceKind.EPISODE
    }
    return text to null
  }

  private fun String.removeWord(word: String): String = when {
    this == word -> ""
    startsWith("$word ") -> substring(word.length + 1).trim()
    else -> this
  }

  private fun String.removeTrailingWord(word: String): String = when {
    this == word -> ""
    endsWith(" $word") -> substring(0, length - word.length - 1).trim()
    else -> this
  }
}

/** Text as voice search compares it: lower case, no accents, no punctuation, single spaces. */
object VoiceText {
  private val MARKS = Regex("""\p{M}+""")
  private val APOSTROPHES = Regex("""['’ʼ`]""")
  private val OTHER = Regex("""[^\p{L}\p{N}]+""")
  private val ARTICLES = setOf("the", "a", "an")

  fun normalize(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFD)
    .replace(MARKS, "")
    .lowercase()
    .replace("&", " and ")
    .replace(APOSTROPHES, "")
    .replace(OTHER, " ")
    .trim()

  /** The words to compare, without “the”, “a” and “an”, which speech often adds or drops. */
  fun words(text: String): List<String> =
    normalize(text).split(' ').filter { it.isNotEmpty() && it !in ARTICLES }
}

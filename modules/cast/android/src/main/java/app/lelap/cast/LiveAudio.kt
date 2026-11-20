package app.lelap.cast

import java.io.OutputStream

/**
 * A part rendered by the phone with its sound effects (M134), for receivers that only take a
 * file: the phone decodes it, runs skip silence, voice boost, even loudness and speed, encodes the
 * result and serves it from its LAN file server as one long stream. The audio stays on the home
 * network. Each fetch renders the part again from the same place, so every speaker of a group
 * gets the same stream.
 */
interface LiveAudio {
  /** `audio/aac` for ADTS AAC. */
  val mimeType: String

  /** The extension receivers look at, without the dot. */
  val extension: String

  /** Where each moment of the stream comes from in the part. */
  val clock: RenderClock

  /** Renders into [out] until the part ends or the receiver hangs up; blocks meanwhile. */
  fun writeTo(out: OutputStream)
}

/**
 * The part's place for a place in the rendered stream. The renderer marks pairs as it goes; with
 * skip silence and speed they part ways, so a receiver's place (in the stream) is mapped back to
 * the book. Every fetch renders the same marks, so a second one only adds what is new.
 */
class RenderClock(private val startMs: Long) {
  private var streamMs = LongArray(64)
  private var mediaMs = LongArray(64)
  private var count = 0

  @Synchronized
  fun mark(atStreamMs: Long, atMediaMs: Long) {
    if (count > 0 && atStreamMs <= streamMs[count - 1]) return
    if (count == streamMs.size) {
      streamMs = streamMs.copyOf(count * 2)
      mediaMs = mediaMs.copyOf(count * 2)
    }
    streamMs[count] = atStreamMs
    mediaMs[count] = atMediaMs
    count++
  }

  /** The part's place, in ms, for [atStreamMs] into the stream; straight on past the last mark. */
  @Synchronized
  fun mediaAt(atStreamMs: Long): Long {
    if (count == 0 || atStreamMs <= 0L) return startMs + atStreamMs.coerceAtLeast(0L)
    var lo = 0
    var hi = count - 1
    if (atStreamMs >= streamMs[hi]) return mediaMs[hi] + (atStreamMs - streamMs[hi])
    // The last mark at or before the place.
    while (lo < hi) {
      val mid = (lo + hi + 1) / 2
      if (streamMs[mid] <= atStreamMs) lo = mid else hi = mid - 1
    }
    if (atStreamMs < streamMs[0]) {
      val span = streamMs[0].toDouble()
      return startMs + ((mediaMs[0] - startMs) * (atStreamMs / span)).toLong()
    }
    val s0 = streamMs[lo]
    val s1 = streamMs[lo + 1]
    val m0 = mediaMs[lo]
    val m1 = mediaMs[lo + 1]
    return m0 + ((m1 - m0) * ((atStreamMs - s0).toDouble() / (s1 - s0))).toLong()
  }

  /**
   * The part's time skip silence left out of the stream up to [atStreamMs], at the last mark
   * there, for a stream rendered at [speed] (M150): what the receiver has played of the part,
   * less what it heard of it. Marks are exact; past the last one nothing is guessed.
   */
  @Synchronized
  fun skippedMs(atStreamMs: Long, speed: Float): Long {
    if (count == 0 || atStreamMs < streamMs[0]) return 0L
    var lo = 0
    var hi = count - 1
    while (lo < hi) {
      val mid = (lo + hi + 1) / 2
      if (streamMs[mid] <= atStreamMs) lo = mid else hi = mid - 1
    }
    return (mediaMs[lo] - startMs - (streamMs[lo] * speed.toDouble()).toLong()).coerceAtLeast(0L)
  }

  val marks: Int
    @Synchronized get() = count
}

/**
 * How a speaker that joins a group while the phone renders the part catches up (M150): a stream
 * of its own, rendered from the leader's place, so the others play on. Loading takes the
 * newcomer a while, during which the leader moves on; when it took longer than [CLOSE_ENOUGH_MS],
 * a second stream starts that much further ahead.
 */
object LiveJoin {
  const val CLOSE_ENOUGH_MS = 1_000L

  /** The lead for a second stream, or null when [loadMs] kept the newcomer close enough. */
  fun secondLead(loadMs: Long): Long? = loadMs.takeIf { it > CLOSE_ENOUGH_MS }

  /**
   * The leader's place in the part [leadMs] from now: [placeMs] as of [atMs] on the same clock,
   * moving at [speed] while it plays.
   */
  fun placeMs(placeMs: Long, atMs: Long, nowMs: Long, speed: Float, playing: Boolean, leadMs: Long): Long {
    if (!playing) return placeMs
    return placeMs + (((nowMs - atMs).coerceAtLeast(0L) + leadMs.coerceAtLeast(0L)) * speed.toDouble()).toLong()
  }
}

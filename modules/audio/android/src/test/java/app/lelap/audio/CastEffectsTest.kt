package app.lelap.audio

import app.lelap.cast.RenderClock
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

class CastEffectsTest {
  private val rate = 44_100

  /** Mono 16-bit PCM: [toneMs] of a tone, [quietMs] of silence, [toneMs] of tone again. */
  private fun speechWithPause(toneMs: Int, quietMs: Int): ByteBuffer {
    val frames = (2 * toneMs + quietMs) * rate / 1000
    val buffer = ByteBuffer.allocate(frames * 2).order(ByteOrder.nativeOrder())
    for (i in 0 until frames) {
      val ms = i * 1000L / rate
      val loud = ms < toneMs || ms >= toneMs + quietMs
      val x = if (loud) (sin(2 * PI * 220 * i / rate) * 12_000).toInt() else 0
      buffer.putShort(x.toShort())
    }
    buffer.flip()
    return buffer
  }

  private fun render(input: ByteBuffer, speed: Float, skipSilence: Boolean, clock: RenderClock, startMs: Long = 60_000L): Int {
    val pipeline = EffectsPipeline(rate, 1, startMs, speed, skipSilence, SoundChain(), clock)
    var out = 0
    // Fed in pieces, as a decoder gives them.
    while (input.hasRemaining()) {
      val piece = input.duplicate().order(ByteOrder.nativeOrder())
      piece.limit(minOf(input.limit(), input.position() + 4_096))
      input.position(piece.limit())
      pipeline.feed(piece) { out += it.remaining() }
    }
    pipeline.end { out += it.remaining() }
    return out / 2
  }

  @Test
  fun withNothingOnThePartPassesThroughAndTheClockKeepsStep() {
    val clock = RenderClock(60_000L)
    val frames = render(speechWithPause(2_000, 2_000), 1f, false, clock)
    assertEquals(6 * rate, frames)
    assertEquals(63_000L, clock.mediaAt(3_000L))
  }

  @Test
  fun skipSilenceShortensTheStreamAndTheClockFollowsThePart() {
    val clock = RenderClock(60_000L)
    val frames = render(speechWithPause(2_000, 3_000), 1f, true, clock)
    val streamMs = frames * 1000L / rate
    // Half of the pause (at most 0.75 s of it kept): well under the part's 7 s.
    assertTrue("stream $streamMs ms", streamMs in 4_500L..5_500L)
    // The voice before the pause is where it was; the end of the stream is the part's end.
    assertTrue(abs(clock.mediaAt(1_000L) - 61_000L) <= 50L)
    assertTrue("end ${clock.mediaAt(streamMs)}", abs(clock.mediaAt(streamMs) - 67_000L) <= 150L)
  }

  @Test
  fun speedMakesTheStreamShorterAndTheClockFaster() {
    val clock = RenderClock(0L)
    val frames = render(speechWithPause(2_000, 2_000), 2f, false, clock, startMs = 0L)
    val streamMs = frames * 1000L / rate
    assertTrue("stream $streamMs ms", streamMs in 2_900L..3_100L)
    assertTrue("at 1.5 s: ${clock.mediaAt(1_500L)}, marks ${clock.marks}", abs(clock.mediaAt(1_500L) - 3_000L) <= 60L)
  }

  @Test
  fun anOddRateIsResampledForAdts() {
    val pipeline = EffectsPipeline(37_800, 2, 0L, 1f, false, SoundChain(), RenderClock(0L))
    assertEquals(44_100, pipeline.outputRate)
  }

  @Test
  fun adtsHeaderForAStereoFrame() {
    // 371 bytes of AAC at 44.1 kHz, stereo: 378 with the header.
    val header = Adts.header(371, 44_100, 2)
    val expected = byteArrayOf(0xFF.toByte(), 0xF1.toByte(), 0x50, 0x80.toByte(), 0x2F, 0x5F, 0xFC.toByte())
    assertArrayEquals(expected, header)
    assertEquals(-1, Adts.rateIndex(37_800))
  }
}

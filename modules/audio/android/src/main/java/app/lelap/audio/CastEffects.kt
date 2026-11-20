package app.lelap.audio

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import app.lelap.cast.RenderClock
import java.nio.ByteBuffer

/**
 * The phone's sound effects on a part it renders for a cast receiver (M134): skip silence, then
 * [SoundProcessor] (voice boost, even loudness, mono, volume boost), then speed, in the order the
 * phone's own player runs them. Takes and gives interleaved 16-bit PCM, and marks on [clock] where
 * each moment of its output comes from in the part.
 *
 * Skip silence and speed are fixed for the stream; a change starts a new one. [SoundChain]'s
 * switches can change while it runs.
 */
@OptIn(UnstableApi::class)
class EffectsPipeline(
  sampleRate: Int,
  channels: Int,
  private val startMs: Long,
  speed: Float,
  skipSilence: Boolean,
  chain: SoundChain,
  private val clock: RenderClock,
) {
  private val silence = SilenceRules.processor().apply { setEnabled(skipSilence) }
  private val sonic = SonicAudioProcessor()
  private val processors: List<AudioProcessor>
  private val pending: Array<ByteBuffer>
  private val frameBytes = 2 * channels
  private val inputRate = sampleRate

  /** The rate it gives out: Android's AAC encoder takes 8 to 48 kHz, so others are resampled. */
  val outputRate: Int = when {
    sampleRate in ENCODER_RATES -> sampleRate
    sampleRate % 11_025 == 0 -> 44_100
    else -> 48_000
  }
  private val usesSonic: Boolean
  private var outFrames = 0L
  private var lastMarkMs = Long.MIN_VALUE / 2
  private var lastSkipped = 0L

  init {
    sonic.setSpeed(speed)
    sonic.setOutputSampleRateHz(outputRate)
    var format = AudioProcessor.AudioFormat(sampleRate, channels, C.ENCODING_PCM_16BIT)
    val active = mutableListOf<AudioProcessor>()
    for (p in listOf(silence, SoundProcessor(chain), sonic)) {
      val out = p.configure(format)
      // A processor that isn't needed says so by configuring to nothing.
      if (out != AudioProcessor.AudioFormat.NOT_SET) {
        p.flush(AudioProcessor.StreamMetadata.DEFAULT)
        if (p.isActive) {
          active += p
          format = out
        }
      }
    }
    processors = active
    pending = Array(active.size) { AudioProcessor.EMPTY_BUFFER }
    usesSonic = sonic in active
  }

  /** Runs [input] through the effects; [sink] gets the output and must take all of each buffer. */
  fun feed(input: ByteBuffer, sink: (ByteBuffer) -> Unit) {
    pump(input, sink)
  }

  /** The part's end: whatever the effects still hold goes out. */
  fun end(sink: (ByteBuffer) -> Unit) {
    if (processors.isEmpty()) return
    var ending = 0
    processors[0].queueEndOfStream()
    // Each processor ends once what the one before it gave is through.
    var guard = 0
    while (ending < processors.size && guard++ < 100_000) {
      pump(AudioProcessor.EMPTY_BUFFER, sink)
      val p = processors[ending]
      if (p.isEnded && !pending[ending].hasRemaining()) {
        ending++
        if (ending < processors.size) processors[ending].queueEndOfStream()
      }
    }
  }

  // Each processor's output is fetched right after it takes input, and it takes input only once
  // that output has moved on: a processor may reuse its output buffer for the next input.
  private fun pump(input: ByteBuffer, sink: (ByteBuffer) -> Unit) {
    if (processors.isEmpty()) {
      if (input.hasRemaining()) emit(input, sink)
      return
    }
    val last = processors.lastIndex
    while (true) {
      var moved = false
      if (pending[last].hasRemaining()) {
        emit(pending[last], sink)
        moved = true
      }
      for (i in last - 1 downTo 0) {
        val out = pending[i]
        if (!out.hasRemaining() || pending[i + 1].hasRemaining()) continue
        val before = out.remaining()
        processors[i + 1].queueInput(out)
        pending[i + 1] = processors[i + 1].output
        if (out.remaining() != before || pending[i + 1].hasRemaining()) moved = true
      }
      if (input.hasRemaining() && !pending[0].hasRemaining()) {
        val before = input.remaining()
        processors[0].queueInput(input)
        pending[0] = processors[0].output
        if (input.remaining() != before || pending[0].hasRemaining()) moved = true
      }
      for (i in 0..last) {
        if (!pending[i].hasRemaining()) {
          val out = processors[i].output
          if (out.hasRemaining()) {
            pending[i] = out
            moved = true
          }
        }
      }
      if (!moved) return
    }
  }

  private fun emit(buffer: ByteBuffer, sink: (ByteBuffer) -> Unit) {
    val frames = buffer.remaining() / frameBytes
    sink(buffer)
    buffer.position(buffer.limit())
    outFrames += frames
    val streamUs = outFrames * 1_000_000L / outputRate
    val playedUs = if (usesSonic) sonic.getMediaDuration(streamUs) else streamUs
    val skipped = silence.skippedFrames
    // Pauses left out are counted in frames of the part, at its own rate.
    val mediaMs = startMs + (playedUs + skipped * 1_000_000L / inputRate) / 1_000L
    val streamMs = streamUs / 1_000L
    // A mark every 200 ms, and at every pause left out, where the two clocks part.
    if (streamMs - lastMarkMs >= MARK_EVERY_MS || skipped != lastSkipped) {
      clock.mark(streamMs, mediaMs)
      lastMarkMs = streamMs
      lastSkipped = skipped
    }
  }

  private companion object {
    const val MARK_EVERY_MS = 200L
    val ENCODER_RATES = setOf(8_000, 11_025, 12_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000)
  }
}

/** ADTS framing for raw AAC from Android's encoder, so receivers can play it as a stream. */
object Adts {
  private val RATES = intArrayOf(96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350)

  const val HEADER_BYTES = 7

  /** The rate's number in the header; -1 for a rate ADTS can't name. */
  fun rateIndex(rate: Int): Int = RATES.indexOf(rate)

  /** The header for one AAC-LC frame of [payload] bytes. */
  fun header(payload: Int, sampleRate: Int, channels: Int): ByteArray {
    val length = payload + HEADER_BYTES
    val rate = rateIndex(sampleRate)
    require(rate >= 0) { "No ADTS rate for $sampleRate Hz" }
    require(length < 1 shl 13) { "Frame too long for ADTS" }
    // Profile 1 (AAC LC, written as its number minus one), no CRC, one raw block per frame.
    return byteArrayOf(
      0xFF.toByte(),
      0xF1.toByte(),
      ((1 shl 6) or (rate shl 2) or ((channels shr 2) and 1)).toByte(),
      (((channels and 3) shl 6) or (length shr 11)).toByte(),
      ((length shr 3) and 0xFF).toByte(),
      (((length and 7) shl 5) or 0x1F).toByte(),
      0xFC.toByte(),
    )
  }
}

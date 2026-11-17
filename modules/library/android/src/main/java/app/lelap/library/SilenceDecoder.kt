package app.lelap.library

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.IOException
import java.nio.ByteOrder

/**
 * Decodes one file on this device with MediaExtractor and MediaCodec and feeds it to a
 * [SilenceScanner], from [fromMs] on. [checkpoint] gets the scanner every few seconds of audio
 * and returns false to stop (the worker was stopped, for example by a low battery).
 */
class SilenceDecoder(private val context: Context) {
  /** A whole file's silences and its decoded length. */
  data class Scanned(val silences: List<Silence>, val durationMs: Long)

  /** The file scanned, or null when the worker was stopped. */
  fun scan(
    uri: String,
    thresholdDb: Double,
    minSilenceMs: Long,
    fromMs: Long,
    earlier: List<Silence>,
    stopped: () -> Boolean,
    checkpoint: (SilenceScanner) -> Boolean,
  ): Scanned? {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(context, Uri.parse(uri), null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IOException("No audio track")
      extractor.selectTrack(track)
      val input = extractor.getTrackFormat(track)
      if (fromMs > 0) extractor.seekTo(fromMs * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val decoder = MediaCodec.createDecoderByType(input.getString(MediaFormat.KEY_MIME)!!)
      codec = decoder
      decoder.configure(input, null, null, 0)
      decoder.start()

      var scanner: SilenceScanner? = null
      var float = false
      var lastCheckpointMs = fromMs
      var inputDone = false
      val info = MediaCodec.BufferInfo()
      var shorts = ShortArray(0)
      var floats = FloatArray(0)
      var idleAfterInput = 0
      var lastMs = fromMs
      while (true) {
        if (stopped()) return null
        if (!inputDone) {
          val i = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (i >= 0) {
            val buffer = decoder.getInputBuffer(i)!!
            val size = extractor.readSampleData(buffer, 0)
            if (size < 0) {
              decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val o = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          float = decoder.outputFormat.let {
            it.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
              it.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
          }
          continue
        }
        if (o < 0) {
          // A decoder that never signals the end once all input is in would loop for good.
          if (inputDone && ++idleAfterInput > MAX_IDLE_AFTER_INPUT) throw IOException("The decoder stopped answering.")
          continue
        }
        idleAfterInput = 0
        val end = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        val atMs = info.presentationTimeUs / 1000
        if (atMs > lastMs) lastMs = atMs
        // A seek lands on the sync frame before the place; what lies before it was scanned.
        if (info.size > 0 && atMs >= fromMs) {
          val s = scanner ?: decoder.outputFormat.let {
            SilenceScanner(
              it.getInteger(MediaFormat.KEY_SAMPLE_RATE),
              it.getInteger(MediaFormat.KEY_CHANNEL_COUNT),
              thresholdDb,
              minSilenceMs,
              atMs,
            )
          }.also { scanner = it }
          val buffer = decoder.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
          buffer.position(info.offset).limit(info.offset + info.size)
          if (float) {
            val count = info.size / 4
            if (floats.size < count) floats = FloatArray(count)
            buffer.asFloatBuffer().get(floats, 0, count)
            s.feed(floats, count)
          } else {
            val count = info.size / 2
            if (shorts.size < count) shorts = ShortArray(count)
            buffer.asShortBuffer().get(shorts, 0, count)
            s.feed(shorts, count)
          }
          if (atMs - lastCheckpointMs >= CHECKPOINT_MS) {
            lastCheckpointMs = atMs
            if (!checkpoint(s)) return null
          }
        }
        decoder.releaseOutputBuffer(o, false)
        if (end) break
      }
      val silences = earlier.filter { it.endMs <= fromMs } + (scanner?.finish() ?: emptyList())
      return Scanned(silences, scanner?.nowMs() ?: lastMs)
    } finally {
      runCatching { codec?.stop() }
      runCatching { codec?.release() }
      extractor.release()
    }
  }

  companion object {
    private const val TIMEOUT_US = 10_000L
    private const val CHECKPOINT_MS = 60_000L
    // 10 ms each: half a minute without output after the last input.
    private const val MAX_IDLE_AFTER_INPUT = 3_000
  }
}

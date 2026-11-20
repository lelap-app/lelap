package app.lelap.audio

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaDataSource
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.util.Log
import app.lelap.cast.CastRequest
import app.lelap.cast.LiveAudio
import app.lelap.cast.RenderClock
import app.lelap.netfs.Netfs
import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * A part of the book rendered on the phone for a cast receiver (M134): decoded with
 * `MediaExtractor` and `MediaCodec`, through [EffectsPipeline], encoded to AAC and sent as ADTS.
 * The receiver's pace sets the phone's: writes wait while it has enough. The file is read from
 * where it lives (the phone, the user's server), never from a Lelap server.
 */
class EffectsStream(
  private val context: Context,
  private val request: CastRequest,
  private val startMs: Long,
  private val speed: Float,
  private val skipSilence: Boolean,
  /** The listener's switches, followed as they change. */
  private val settings: SoundChain,
) : LiveAudio {
  override val mimeType = "audio/aac"
  override val extension = "aac"
  override val clock = RenderClock(startMs)

  override fun writeTo(out: OutputStream) {
    val extractor = MediaExtractor()
    var decoder: MediaCodec? = null
    var encoder: AacEncoder? = null
    val started = System.nanoTime()
    try {
      open(extractor)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IOException("No audio in the file")
      extractor.selectTrack(track)
      val format = extractor.getTrackFormat(track)
      val startUs = startMs * 1_000L
      if (startUs > 0) extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      decoder = codec
      codec.configure(format, null, null, 0)
      codec.start()
      val chain = SoundChain().also { it.follow(settings) }
      var pipeline: EffectsPipeline? = null
      val sink = BufferedOutputStream(out, 16 * 1024)
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var outputDone = false
      while (!outputDone) {
        if (!inputDone) {
          val i = codec.dequeueInputBuffer(TIMEOUT_US)
          if (i >= 0) {
            val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
            if (n < 0) {
              codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val o = codec.dequeueOutputBuffer(info, TIMEOUT_US)
        if (o < 0) continue
        val buffer = codec.getOutputBuffer(o)!!
        if (pipeline == null) {
          val pcm = codec.outputFormat
          val encoding = if (pcm.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcm.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
          if (encoding != AudioFormat.ENCODING_PCM_16BIT) throw IOException("Decoder gives PCM encoding $encoding")
          val rate = pcm.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          val channels = pcm.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          pipeline = EffectsPipeline(rate, channels, startMs, speed, skipSilence, chain, clock)
          encoder = AacEncoder(pipeline.outputRate, channels, sink)
          Log.i(TAG, "cast-render ${rate / 1000} kHz, $channels ch, speed $speed, skip silence $skipSilence")
        }
        val p = pipeline
        val e = encoder!!
        buffer.position(info.offset)
        buffer.limit(info.offset + info.size)
        buffer.order(ByteOrder.nativeOrder())
        // A seek lands on the frame before the place; what lies before it is left out.
        val frameBytes = 2 * codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        if (info.presentationTimeUs < startUs && info.size > 0) {
          val rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          val early = ((startUs - info.presentationTimeUs) * rate / 1_000_000L) * frameBytes
          buffer.position((info.offset + early).coerceAtMost(info.offset.toLong() + info.size).toInt())
        }
        chain.follow(settings)
        if (buffer.hasRemaining()) p.feed(buffer) { e.encode(it) }
        codec.releaseOutputBuffer(o, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
      }
      pipeline?.end { pcm -> encoder?.encode(pcm) }
      encoder?.finish()
      sink.flush()
      Log.i(TAG, "cast-render ended after ${(System.nanoTime() - started) / 1_000_000L} ms")
    } catch (e: Exception) {
      // The receiver hung up (a seek, a pause it gave up on, the end of casting), or the file failed.
      Log.i(TAG, "cast-render stopped after ${(System.nanoTime() - started) / 1_000_000L} ms: ${e.javaClass.simpleName}")
    } finally {
      runCatching { decoder?.stop() }
      runCatching { decoder?.release() }
      runCatching { encoder?.release() }
      runCatching { extractor.release() }
    }
  }

  private fun open(extractor: MediaExtractor) {
    val uri = request.uri
    when {
      uri.startsWith("file://") || uri.startsWith("content://") -> extractor.setDataSource(context, Uri.parse(uri), null)
      Netfs.handles(uri) -> {
        val (length, opener) = Netfs.opener(uri, request.headers)
        extractor.setDataSource(RangeSource(length, opener))
      }
      // Through the phone's own requests, so a login goes only to the file's server (LoginRedirects).
      else -> extractor.setDataSource(RangeSource.http(uri, request.headers))
    }
  }

  private companion object {
    const val TAG = "LelapCast"
    const val TIMEOUT_US = 10_000L
  }
}

/** Random reads for `MediaExtractor` from a file it can only open at an offset; reopens on a jump. */
class RangeSource(private val length: Long, private val open: (Long) -> InputStream) : MediaDataSource() {
  private var stream: InputStream? = null
  private var at = -1L

  override fun getSize(): Long = length

  @Synchronized
  override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
    if (position >= length) return -1
    if (size == 0) return 0
    if (stream == null || position != at) {
      runCatching { stream?.close() }
      stream = open(position)
      at = position
    }
    val n = stream!!.read(buffer, offset, minOf(size.toLong(), length - position).toInt())
    if (n < 0) return -1
    at += n
    return n
  }

  @Synchronized
  override fun close() {
    runCatching { stream?.close() }
    stream = null
  }

  companion object {
    /** A file on an HTTP server, read with range requests and the login for its own host only. */
    fun http(url: String, headers: Map<String, String>): RangeSource {
      val length = LoginRedirects.open(url, headers) { c ->
        c.requestMethod = "GET"
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        c.setRequestProperty("Range", "bytes=0-0")
      }.let { c ->
        try {
          c.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull()
            ?: c.getHeaderFieldLong("Content-Length", -1L).takeIf { c.responseCode == 200 }
            ?: throw IOException("No length for the file")
        } finally {
          c.disconnect()
        }
      }
      return RangeSource(length) { offset ->
        val c = LoginRedirects.open(url, headers) { c ->
          c.connectTimeout = 15_000
          c.readTimeout = 30_000
          c.setRequestProperty("Range", "bytes=$offset-")
        }
        if (c.responseCode != 206 && !(offset == 0L && c.responseCode == 200)) {
          c.disconnect()
          throw IOException("HTTP ${c.responseCode}")
        }
        c.inputStream
      }
    }
  }
}

/** Android's AAC-LC encoder, written out as ADTS frames. */
private class AacEncoder(private val sampleRate: Int, private val channels: Int, private val out: OutputStream) {
  private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels)
    format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
    // Plenty for speech; a stereo book gets a little more.
    format.setInteger(MediaFormat.KEY_BIT_RATE, if (channels == 1) 64_000 else 96_000)
    format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
    configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    start()
  }
  private val info = MediaCodec.BufferInfo()
  private val frameBytes = 2 * channels
  private var framesIn = 0L
  private var scratch = ByteArray(0)

  fun encode(pcm: ByteBuffer) {
    while (pcm.remaining() >= frameBytes) {
      val i = codec.dequeueInputBuffer(TIMEOUT_US)
      if (i >= 0) {
        val input = codec.getInputBuffer(i)!!
        input.clear()
        val n = minOf(input.remaining(), pcm.remaining()) / frameBytes * frameBytes
        val slice = pcm.duplicate()
        slice.limit(pcm.position() + n)
        input.put(slice)
        pcm.position(pcm.position() + n)
        codec.queueInputBuffer(i, 0, n, framesIn * 1_000_000L / sampleRate, 0)
        framesIn += n / frameBytes
      }
      drain(untilEnd = false)
    }
  }

  fun finish() {
    var queued = false
    while (!queued) {
      val i = codec.dequeueInputBuffer(TIMEOUT_US)
      if (i >= 0) {
        codec.queueInputBuffer(i, 0, 0, framesIn * 1_000_000L / sampleRate, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        queued = true
      } else {
        drain(untilEnd = false)
      }
    }
    drain(untilEnd = true)
  }

  fun release() {
    runCatching { codec.stop() }
    codec.release()
  }

  private fun drain(untilEnd: Boolean) {
    while (true) {
      val o = codec.dequeueOutputBuffer(info, if (untilEnd) TIMEOUT_US else 0L)
      if (o == MediaCodec.INFO_TRY_AGAIN_LATER) {
        if (untilEnd) continue
        return
      }
      if (o < 0) continue
      val data = codec.getOutputBuffer(o)!!
      if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
        if (scratch.size < info.size) scratch = ByteArray(info.size)
        data.position(info.offset)
        data.get(scratch, 0, info.size)
        out.write(Adts.header(info.size, sampleRate, channels))
        out.write(scratch, 0, info.size)
      }
      codec.releaseOutputBuffer(o, false)
      if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
    }
  }

  private companion object {
    const val TIMEOUT_US = 10_000L
  }
}

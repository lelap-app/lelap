package app.lelap.audio

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.SilenceSkippingAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

/**
 * Runs [SoundChain] in ExoPlayer's audio sink. It stays active for every PCM stream and passes
 * samples through untouched while all effects are off, so switching one never reconfigures the
 * sink or rebuffers.
 *
 * It also counts what Media3's [silence] processor, which runs after it, leaves out (M84): that
 * processor's count starts again at every flush, and this one is flushed first.
 */
@OptIn(UnstableApi::class)
class SoundProcessor(
  val chain: SoundChain,
  private val silence: SilenceSkippingAudioProcessor = SilenceRules.processor(),
) : BaseAudioProcessor() {
  private var buffer = FloatArray(0)
  private val skipped = SkippedFrames()
  private val skippedUs = AtomicLong()

  /** Media time skip silence left out since the last call, in microseconds. Any thread. */
  fun takeSkippedUs(): Long = skippedUs.getAndSet(0L)

  private fun count(frames: Long) {
    val rate = inputAudioFormat.sampleRate
    if (frames > 0L && rate > 0) skippedUs.addAndGet(frames * 1_000_000L / rate)
  }

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    val encoding = inputAudioFormat.encoding
    if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) return AudioProcessor.AudioFormat.NOT_SET
    chain.configure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount)
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    count(skipped.observe(silence.skippedFrames))
    val bytes = inputBuffer.remaining()
    if (bytes == 0) return
    val output = replaceOutputBuffer(bytes)
    if (!chain.isActive) {
      output.put(inputBuffer)
      output.flip()
      return
    }
    val float = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
    val count = bytes / if (float) 4 else 2
    if (buffer.size < count) buffer = FloatArray(count)
    val input = inputBuffer.order(ByteOrder.nativeOrder())
    if (float) {
      for (i in 0 until count) buffer[i] = input.getFloat()
    } else {
      for (i in 0 until count) buffer[i] = input.getShort() / 32768f
    }
    chain.process(buffer, count / inputAudioFormat.channelCount)
    if (float) {
      for (i in 0 until count) output.putFloat(buffer[i])
    } else {
      for (i in 0 until count) output.putShort((buffer[i] * 32767f).roundToInt().coerceIn(-32768, 32767).toShort())
    }
    output.flip()
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    count(skipped.flush(silence.skippedFrames))
    chain.reset()
  }

  override fun onReset() {
    count(skipped.flush(silence.skippedFrames))
    chain.reset()
    buffer = FloatArray(0)
  }
}

/**
 * Skip silence (M84) shortens pauses longer than [MIN_SILENCE_US] to half, and never keeps more
 * than [MAX_KEPT_US] of one: a sentence still ends with a breath, a long gap goes. Media3's
 * defaults (from 0.1 s, a fifth kept) suit music more than a narrator.
 */
@OptIn(UnstableApi::class)
object SilenceRules {
  const val MIN_SILENCE_US = 400_000L
  const val RETENTION = 0.5f
  const val MAX_KEPT_US = 750_000L

  fun processor() = SilenceSkippingAudioProcessor(
    MIN_SILENCE_US,
    RETENTION,
    MAX_KEPT_US,
    SilenceSkippingAudioProcessor.DEFAULT_MIN_VOLUME_TO_KEEP_PERCENTAGE,
    SilenceSkippingAudioProcessor.DEFAULT_SILENCE_THRESHOLD_LEVEL,
  )
}

/**
 * Puts a [SoundProcessor] in front of ExoPlayer's own processors (silence, then speed), with the
 * silence processor it counts for. `ExoPlayer.setSkipSilenceEnabled` switches that one.
 */
@OptIn(UnstableApi::class)
class SoundRenderersFactory(
  context: Context,
  private val processor: SoundProcessor,
  private val silence: SilenceSkippingAudioProcessor,
) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioOutputPlaybackParams: Boolean,
  ): AudioSink =
    DefaultAudioSink.Builder(context)
      .setEnableFloatOutput(enableFloatOutput)
      .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
      .setAudioProcessorChain(
        DefaultAudioSink.DefaultAudioProcessorChain(arrayOf(processor), silence, SonicAudioProcessor()),
      )
      .build()
}

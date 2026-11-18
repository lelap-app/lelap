package app.lelap.audio

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessorChain
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
 */
@OptIn(UnstableApi::class)
class SoundProcessor(val chain: SoundChain, private val tally: SilenceTally? = null) : BaseAudioProcessor() {
  private var buffer = FloatArray(0)

  /** The sample rate of the stream it plays now; 0 before one is configured. */
  val sampleRate: Int
    get() = inputAudioFormat.sampleRate.coerceAtLeast(0)

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    val encoding = inputAudioFormat.encoding
    if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) return AudioProcessor.AudioFormat.NOT_SET
    chain.configure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount)
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    tally?.observe(sampleRate)
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
    chain.reset()
  }

  override fun onReset() {
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
 * Media time skip silence left out (M84). Media3's count of skipped frames starts again at every
 * flush, so it is looked at with every buffer and just before each flush ([SilenceFlushWatch]).
 * Looks happen on the playback thread; [takeSkippedUs] on any.
 */
@OptIn(UnstableApi::class)
class SilenceTally(val silence: SilenceSkippingAudioProcessor) {
  private val frames = SkippedFrames()
  private val skippedUs = AtomicLong()

  fun observe(sampleRate: Int) = add(frames.observe(silence.skippedFrames), sampleRate)

  fun flush(sampleRate: Int) = add(frames.flush(silence.skippedFrames), sampleRate)

  /** Media time left out since the last call, in microseconds. */
  fun takeSkippedUs(): Long = skippedUs.getAndSet(0L)

  private fun add(count: Long, sampleRate: Int) {
    if (count > 0L && sampleRate > 0) skippedUs.addAndGet(count * 1_000_000L / sampleRate)
  }
}

/**
 * Sits in front of the silence processor and never touches audio. Media3 flushes every processor
 * in order, active or not, so this one sees the count before it starts again, while
 * [rate] still gives the sample rate it was counted at.
 */
@OptIn(UnstableApi::class)
class SilenceFlushWatch(private val tally: SilenceTally, private val rate: () -> Int) : BaseAudioProcessor() {
  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
    AudioProcessor.AudioFormat.NOT_SET

  override fun queueInput(inputBuffer: ByteBuffer) = Unit

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) = tally.flush(rate())
}

/**
 * Silence first, then [SoundProcessor], then speed: pauses are found in the recording as it is,
 * before voice boost or even loudness lift its room noise. Media3's own chain puts silence after
 * custom processors, so this one routes `setSkipSilenceEnabled` to its own silence processor and
 * leaves the inner chain's switched off.
 */
@OptIn(UnstableApi::class)
class SoundAudioProcessorChain(processor: SoundProcessor, private val tally: SilenceTally) :
  DefaultAudioSink.AudioProcessorChain {
  private val inner = DefaultAudioSink.DefaultAudioProcessorChain(
    arrayOf(SilenceFlushWatch(tally) { processor.sampleRate }, tally.silence, processor),
    SilenceSkippingAudioProcessor(),
    SonicAudioProcessor(),
  )

  override fun getAudioProcessors(): Array<AudioProcessor> = inner.audioProcessors

  override fun applyPlaybackParameters(playbackParameters: PlaybackParameters): PlaybackParameters =
    inner.applyPlaybackParameters(playbackParameters)

  override fun applySkipSilenceEnabled(skipSilenceEnabled: Boolean): Boolean {
    tally.silence.setEnabled(skipSilenceEnabled)
    return skipSilenceEnabled
  }

  override fun getMediaDuration(playoutDuration: Long): Long = inner.getMediaDuration(playoutDuration)

  // Media frames, at the rate the silence processor read them, as Media3's own chain reports.
  override fun getSkippedOutputFrameCount(): Long = tally.silence.skippedFrames
}

/** Plays through [SoundAudioProcessorChain]; `ExoPlayer.setSkipSilenceEnabled` switches skip silence. */
@OptIn(UnstableApi::class)
class SoundRenderersFactory(context: Context, private val chain: SoundAudioProcessorChain) :
  DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioOutputPlaybackParams: Boolean,
  ): AudioSink =
    DefaultAudioSink.Builder(context)
      .setEnableFloatOutput(enableFloatOutput)
      .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
      .setAudioProcessorChain(chain)
      .build()
}

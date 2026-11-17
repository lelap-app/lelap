package app.lelap.audio

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Runs [SoundChain] in ExoPlayer's audio sink. It stays active for every PCM stream and passes
 * samples through untouched while all effects are off, so switching one never reconfigures the
 * sink or rebuffers.
 */
@OptIn(UnstableApi::class)
class SoundProcessor(val chain: SoundChain) : BaseAudioProcessor() {
  private var buffer = FloatArray(0)

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    val encoding = inputAudioFormat.encoding
    if (encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) return AudioProcessor.AudioFormat.NOT_SET
    chain.configure(inputAudioFormat.sampleRate, inputAudioFormat.channelCount)
    return inputAudioFormat
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
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

/** Puts a [SoundProcessor] in front of ExoPlayer's own processors (speed, silence). */
@OptIn(UnstableApi::class)
class SoundRenderersFactory(context: Context, private val processor: SoundProcessor) :
  DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioOutputPlaybackParams: Boolean,
  ): AudioSink =
    DefaultAudioSink.Builder(context)
      .setEnableFloatOutput(enableFloatOutput)
      .setEnableAudioOutputPlaybackParameters(enableAudioOutputPlaybackParams)
      .setAudioProcessors(arrayOf(processor))
      .build()
}

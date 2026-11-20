package app.lelap.cast

/** A speaker or TV found on the network. [kind] is `upnp`, `cast` or `fcast`. */
data class CastDevice(
  val id: String,
  val name: String,
  val kind: String,
  val host: String,
  val port: Int,
  val model: String? = null,
  /** UPnP only: SOAP control URLs. */
  val avTransportUrl: String? = null,
  val renderingControlUrl: String? = null,
  val avTransportScpdUrl: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf("id" to id, "name" to name, "kind" to kind, "model" to model)
}

/** One file for a receiver, with a URL it can fetch itself. */
data class CastMedia(
  val url: String,
  val mimeType: String,
  val title: String,
  val artist: String?,
  val album: String?,
  val coverUrl: String?,
  val durationMs: Long,
  /** A stream the phone renders as it goes (M134): no length, no seeking on the receiver. */
  val live: Boolean = false,
)

enum class PlayState { IDLE, BUFFERING, PLAYING, PAUSED, ENDED }

data class RendererStatus(
  val state: PlayState,
  val positionMs: Long,
  val durationMs: Long,
  /** 0..1, null when the receiver does not say. */
  val volume: Float?,
  val error: String? = null,
)

/** The few controls every protocol offers. Calls may block on the network; never on main. */
interface Renderer {
  fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float)
  fun play()
  fun pause()
  fun seek(positionMs: Long)
  fun setSpeed(speed: Float)
  /** Whether [setSpeed] and [load] can play at [speed]; otherwise the receiver plays at 1×. */
  fun canPlayAt(speed: Float): Boolean = true
  fun setVolume(level: Float)
  fun status(): RendererStatus
  /** Stops playback on the receiver and lets it go. */
  fun close()
}

/**
 * A receiver that remembers the file it was last given and the speed it plays at, so a speaker
 * that joins later can start the same file (M125). Everything else goes straight through.
 */
class RememberingRenderer(
  private val inner: Renderer,
  /** What the speaker it takes over from had been given (M139). */
  media: CastMedia? = null,
  speed: Float = 1f,
) : Renderer {
  @Volatile
  var media: CastMedia? = media
    private set

  @Volatile
  var speed: Float = speed
    private set

  override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) {
    inner.load(media, startMs, autoplay, speed)
    this.media = media
    this.speed = speed
  }

  override fun play() = inner.play()

  override fun pause() = inner.pause()

  override fun seek(positionMs: Long) = inner.seek(positionMs)

  override fun setSpeed(speed: Float) {
    inner.setSpeed(speed)
    this.speed = speed
  }

  override fun canPlayAt(speed: Float): Boolean = inner.canPlayAt(speed)

  override fun setVolume(level: Float) = inner.setVolume(level)

  override fun status(): RendererStatus = inner.status()

  override fun close() = inner.close()
}

open class CastException(message: String) : Exception(message)

/**
 * A Google Cast speaker failed device authentication (M78). [fingerprint] is the TLS certificate
 * its connection showed, which “Connect anyway” pins (M125); null when it showed none.
 */
class CastUntrustedException(val device: CastDevice, val fingerprint: String?) : CastException(
  app.lelap.text.NativeText.current().t(
    "{name} didn’t prove it’s a genuine Google Cast device, so Lelap didn’t connect.",
    "name" to device.name,
  ),
)

/** Turns "played and then stopped" into [PlayState.ENDED], which some protocols do not report. */
class EndWatch {
  private var playing = false

  /** Whether the last state seen was playing. */
  val isPlaying: Boolean
    get() = playing

  /** Call on load, pause and stop: a stop after those is not the end of the file. */
  fun reset() {
    playing = false
  }

  fun map(state: PlayState): PlayState {
    if (state == PlayState.PLAYING) playing = true
    if (state == PlayState.IDLE && playing) {
      playing = false
      return PlayState.ENDED
    }
    if (state == PlayState.PAUSED) playing = false
    return state
  }
}

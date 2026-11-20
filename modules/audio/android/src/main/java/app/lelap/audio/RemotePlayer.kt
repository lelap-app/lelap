package app.lelap.audio

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DeviceInfo
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import app.lelap.cast.CastLink
import app.lelap.cast.CastRequest
import app.lelap.cast.LiveAudio
import app.lelap.cast.ReceiverFade
import app.lelap.cast.RemoteSession
import app.lelap.cast.RenderClock
import app.lelap.cast.RendererStatus
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The media session's player while casting (M50): the book's parts as a playlist, playing on a
 * receiver through [CastLink]. With it as the session's player, the notification, lock screen,
 * headphones, watches and Android Auto control the receiver, and Media3 keeps the playback
 * service in the foreground while it plays. The decisions are [RemoteSession]'s.
 */
@OptIn(UnstableApi::class)
class RemotePlayer(
  looper: Looper,
  private val link: CastLink,
  /** The file at an index of the loaded book, as the receiver should get it. */
  private val requestFor: (Int) -> CastRequest?,
  /** Android Auto picked a book: the service loads it like the app would, then calls [setBook]. */
  private val onItemsPicked: (List<MediaItem>, Int, Long) -> Unit,
  /** A file loaded on the receiver (null), or why it did not; the service hands back on a failure. */
  private val onLoaded: (String?) -> Unit,
  /** On Play: where smart rewind resumes the part at [index] from [positionMs], or null to play on. */
  private val resumePlace: (index: Int, positionMs: Long) -> Long?,
  /**
   * The part rendered by the phone with the listener's effects (M134), from a place at a speed;
   * null when it can't be, and the receiver then plays the file.
   */
  private val render: (request: CastRequest, startMs: Long, speed: Float) -> LiveAudio? = { _, _, _ -> null },
) : SimpleBasePlayer(looper) {
  private val handler = Handler(looper)
  private val session = RemoteSession(SystemClock::elapsedRealtime, link::canPlayAt, ::logTiming)
  private val fade = ReceiverFade()
  private var items: List<MediaItem> = emptyList()
  private var released = false

  // The rendered stream's clock, mapping the receiver's place to the part's; null for a file.
  private var clock: RenderClock? = null

  private val linkListener = object : CastLink.Listener {
    override fun onStatus(status: RendererStatus) {
      handler.post { if (!released) onStatus(status) }
    }

    override fun onClosed(error: String?) = Unit

    override fun onRestartNeeded() {
      handler.post { if (!released) run(session.restart()) }
    }
  }

  init {
    link.addListener(linkListener)
  }

  /** What the listener asked for; the receiver may play at 1× instead. */
  val requestedSpeed: Float
    get() = session.requestedSpeed

  /**
   * A book (or the next in Up Next) on the receiver, from [index] at [positionMs]. Playback that
   * reaches [outroAtMs] in the last part ends it there, as the phone's player does.
   */
  fun setBook(
    bookItems: List<MediaItem>,
    durations: List<Long>,
    index: Int,
    positionMs: Long,
    speed: Float,
    play: Boolean,
    outroAtMs: Long?,
  ) {
    items = bookItems
    run(session.start(durations, index, positionMs, play, speed, outroAtMs))
  }

  /**
   * The listener's sound effects are on (M134): the phone renders each part with them. A part
   * that plays starts again from the place, rendered or as the file.
   */
  fun setEffects(on: Boolean) = run(session.setEffects(on))

  /** Whether the phone renders the parts now. */
  val rendering: Boolean
    get() = session.phoneRenders

  /** Skip silence went on or off while the phone renders: the stream starts again with it. */
  fun restartRendering() {
    if (session.phoneRenders) run(session.restart())
  }

  /** The show's outro changed while its episode plays on the receiver. */
  fun setOutro(atMs: Long?) = session.setOutro(atMs)

  // Read with `adb logcat -s LelapCast`: the protocol and numbers only, no names or addresses.
  private fun logTiming(timing: RemoteSession.Timing) {
    Log.i(TAG, "${link.device.kind} ${timing.what} ${timing.ms} ms")
  }

  // The level last asked for; kept, since a receiver says its volume only after its first status.
  private var fadeLevel = 1f

  /**
   * The sleep timer's fade times the bedtime routine's volume (M125), 1 for none; lowers the
   * receiver's own volume where it says it, and puts it back at 1. A group's speakers keep their
   * shares, as with the volume buttons.
   */
  fun setFade(level: Float) {
    fadeLevel = level
    applyFade()
  }

  private fun applyFade() {
    fade.update(fadeLevel, session.volume, SystemClock.elapsedRealtime())?.let(link::setVolume)
    // A speaker that joins a group meanwhile is lowered as much as the others.
    link.setFadeScale(if (fade.isFading) fadeLevel.coerceIn(0f, 1f) else 1f)
  }

  private fun onStatus(status: RendererStatus) {
    // A rendered stream's place is the stream's; the part's comes from the renderer's clock.
    val mapped = clock?.let { status.copy(positionMs = it.mediaAt(status.positionMs), durationMs = 0L) } ?: status
    run(session.onStatus(mapped))
    if (fadeLevel < 1f || fade.isFading) applyFade()
  }

  private fun run(commands: List<RemoteSession.Command>) {
    for (command in commands) {
      when (command) {
        is RemoteSession.Command.Load -> {
          val file = requestFor(command.index)
          val live = if (file != null && session.phoneRenders) render(file, command.positionMs, command.speed) else null
          clock = live?.clock
          val request = if (live != null) file?.copy(live = live) else file
          if (request == null) {
            session.onLoaded(command.seq, MISSING)
            handler.post { if (!released) onLoaded(MISSING) }
            continue
          }
          // A rendered stream starts at the place and carries the speed; the receiver plays it at 1×.
          val startMs = if (live != null) 0L else command.positionMs
          val speed = if (live != null) 1f else command.speed
          link.load(request, startMs, command.autoplay, speed) { failure ->
            handler.post {
              if (released) return@post
              // A load that a newer one replaced (quick skips) changes nothing.
              if (!session.onLoaded(command.seq, failure)) return@post
              invalidateState()
              onLoaded(failure)
            }
          }
        }
        // A control the receiver refused is not shown as an error: the next poll brings its
        // real state back, and playback goes on.
        RemoteSession.Command.Play -> link.run { it.play() }
        RemoteSession.Command.Pause -> link.run { it.pause() }
        is RemoteSession.Command.Seek -> link.run { it.seek(command.positionMs) }
        is RemoteSession.Command.SetSpeed -> link.run(::speedRefused) { it.setSpeed(command.speed) }
      }
    }
    invalidateState()
  }

  // A speed the renderer listed but refused: it plays at 1x now, which canPlayAt says from here.
  private fun speedRefused(@Suppress("UNUSED_PARAMETER") message: String) {
    handler.post { if (!released) invalidateState() }
  }

  override fun getState(): State {
    val builder = State.Builder()
      .setAvailableCommands(COMMANDS)
      .setPlayWhenReady(session.playWhenReady, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
      .setPlaybackParameters(PlaybackParameters(session.speed))
    session.error?.let {
      builder.setPlayerError(PlaybackException(it, null, PlaybackException.ERROR_CODE_REMOTE_ERROR))
    }
    session.volume?.let { volume ->
      builder.setDeviceInfo(DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE).setMaxVolume(100).build())
        .setDeviceVolume((volume * 100).toInt().coerceIn(0, 100))
    }
    if (items.isEmpty()) return builder.setPlaybackState(Player.STATE_IDLE).build()
    val playlist = items.mapIndexed { i, item ->
      val length = session.durationOf(i)
      MediaItemData.Builder("$i:${item.mediaId}")
        .setMediaItem(item)
        .setDurationUs(if (length > 0) length * 1_000 else C.TIME_UNSET)
        .setIsSeekable(true)
        .build()
    }
    val position = session.position()
    return builder
      .setPlaylist(playlist)
      .setCurrentMediaItemIndex(session.index.coerceIn(0, items.lastIndex))
      .setContentPositionMs(
        if (session.advancing) PositionSupplier.getExtrapolating(position, session.speed) else PositionSupplier.getConstant(position),
      )
      .setPlaybackState(
        when (session.phase) {
          RemoteSession.Phase.IDLE -> Player.STATE_IDLE
          RemoteSession.Phase.BUFFERING -> Player.STATE_BUFFERING
          RemoteSession.Phase.READY -> Player.STATE_READY
          RemoteSession.Phase.ENDED -> Player.STATE_ENDED
        },
      )
      .build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    run(if (playWhenReady) session.play(resumePlace(session.index, session.position())) else session.pause())
    return Futures.immediateVoidFuture()
  }

  // Play after a stop (or an error) loads the file again from the place.
  override fun handlePrepare(): ListenableFuture<*> = Futures.immediateVoidFuture()

  override fun handleStop(): ListenableFuture<*> {
    run(session.pause())
    return Futures.immediateVoidFuture()
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    val index = if (mediaItemIndex == C.INDEX_UNSET) session.index else mediaItemIndex
    run(session.seek(index, if (positionMs == C.TIME_UNSET) 0L else positionMs))
    return Futures.immediateVoidFuture()
  }

  override fun handleSetPlaybackParameters(playbackParameters: PlaybackParameters): ListenableFuture<*> {
    run(session.setSpeed(playbackParameters.speed.coerceIn(0.5f, 3f)))
    return Futures.immediateVoidFuture()
  }

  override fun handleSetMediaItems(mediaItems: List<MediaItem>, startIndex: Int, startPositionMs: Long): ListenableFuture<*> {
    onItemsPicked(
      mediaItems,
      if (startIndex == C.INDEX_UNSET) 0 else startIndex,
      if (startPositionMs == C.TIME_UNSET) 0L else startPositionMs,
    )
    return Futures.immediateVoidFuture()
  }

  // Only the chapter title on the lock screen changes this way; the files stay the same.
  override fun handleReplaceMediaItems(fromIndex: Int, toIndex: Int, mediaItems: List<MediaItem>): ListenableFuture<*> {
    items = items.take(fromIndex) + mediaItems + items.drop(toIndex)
    return Futures.immediateVoidFuture()
  }

  override fun handleSetDeviceVolume(deviceVolume: Int, flags: Int): ListenableFuture<*> {
    sendVolume(deviceVolume / 100f)
    return Futures.immediateVoidFuture()
  }

  override fun handleIncreaseDeviceVolume(flags: Int): ListenableFuture<*> = stepVolume(VOLUME_STEP)

  override fun handleDecreaseDeviceVolume(flags: Int): ListenableFuture<*> = stepVolume(-VOLUME_STEP)

  // The receiver reports its volume once a second; presses in between step from the last one sent.
  private var pendingVolume: Float? = null

  private fun stepVolume(delta: Float): ListenableFuture<*> {
    (pendingVolume ?: session.volume)?.let { sendVolume(it + delta) }
    return Futures.immediateVoidFuture()
  }

  private fun sendVolume(level: Float) {
    val volume = level.coerceIn(0f, 1f)
    pendingVolume = volume
    link.setVolume(volume)
    handler.removeCallbacks(forgetPendingVolume)
    handler.postDelayed(forgetPendingVolume, 2_000L)
  }

  private val forgetPendingVolume = Runnable { pendingVolume = null }

  override fun handleRelease(): ListenableFuture<*> {
    released = true
    link.removeListener(linkListener)
    handler.removeCallbacksAndMessages(null)
    return Futures.immediateVoidFuture()
  }

  private companion object {
    const val TAG = "LelapCast"
    const val VOLUME_STEP = 0.05f
    const val MISSING = "This part of the book is missing"

    val COMMANDS: Player.Commands = Player.Commands.Builder().addAll(
      Player.COMMAND_PLAY_PAUSE,
      Player.COMMAND_PREPARE,
      Player.COMMAND_STOP,
      Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_BACK,
      Player.COMMAND_SEEK_FORWARD,
      Player.COMMAND_SET_SPEED_AND_PITCH,
      Player.COMMAND_SET_MEDIA_ITEM,
      Player.COMMAND_CHANGE_MEDIA_ITEMS,
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
      Player.COMMAND_GET_TIMELINE,
      Player.COMMAND_GET_METADATA,
      Player.COMMAND_GET_DEVICE_VOLUME,
      Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS,
      Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS,
      Player.COMMAND_RELEASE,
    ).build()
  }
}

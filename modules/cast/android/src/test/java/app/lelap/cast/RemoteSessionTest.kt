package app.lelap.cast

import app.lelap.cast.RemoteSession.Command
import app.lelap.cast.RemoteSession.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteSessionTest {
  private var now = 0L
  private var speeds = setOf(1f, 1.5f)
  private val session = RemoteSession({ now }, { it in speeds })
  private val parts = listOf(60_000L, 60_000L, 60_000L)

  private fun status(state: PlayState, positionMs: Long = 0L, volume: Float? = null) =
    RendererStatus(state, positionMs, 60_000L, volume)

  private fun started(index: Int = 0, positionMs: Long = 0L): List<Command> {
    val commands = session.start(parts, index, positionMs, play = true, speed = 1f)
    session.onLoaded(null)
    return commands
  }

  @Test
  fun startLoadsThePartAtThePlaceAndPlays() {
    val commands = session.start(parts, 1, 12_000L, play = true, speed = 1.5f)
    assertEquals(listOf(Command.Load(1, 12_000L, true, 1.5f)), commands)
    assertEquals(Phase.BUFFERING, session.phase)
    assertTrue(session.playWhenReady)
    assertEquals(12_000L, session.position())
  }

  @Test
  fun statusesFromBeforeTheLoadFinishedAreIgnored() {
    session.start(parts, 0, 0L, play = true, speed = 1f)
    // The receiver still reports the file before as ended; that must not skip a part.
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.ENDED)))
    assertEquals(0, session.index)
  }

  @Test
  fun aPartThatEndsLoadsTheNextOnce() {
    started()
    session.onStatus(status(PlayState.PLAYING, 59_000L))
    assertEquals(listOf(Command.Load(1, 0L, true, 1f)), session.onStatus(status(PlayState.ENDED)))
    // Receivers may say "ended" again before the load is done.
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.ENDED)))
    assertEquals(1, session.index)
  }

  @Test
  fun theLastPartEndingEndsTheBookAtItsEnd() {
    started(index = 2)
    session.onStatus(status(PlayState.PLAYING, 59_500L))
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.ENDED)))
    assertEquals(Phase.ENDED, session.phase)
    assertFalse(session.playWhenReady)
    assertEquals(60_000L, session.position())
    // A stop that follows keeps the book ended.
    session.onStatus(status(PlayState.IDLE))
    assertEquals(Phase.ENDED, session.phase)
  }

  @Test
  fun anotherBookAfterTheEndLoadsOnTheSameReceiver() {
    started(index = 2)
    session.onStatus(status(PlayState.ENDED))
    val next = session.start(listOf(30_000L), 0, 5_000L, play = true, speed = 1f)
    assertEquals(listOf(Command.Load(0, 5_000L, true, 1f)), next)
    assertEquals(Phase.BUFFERING, session.phase)
  }

  @Test
  fun thePlaceMovesOnAtTheSpeedWhilePlaying() {
    session.start(parts, 0, 0L, play = true, speed = 1.5f)
    session.onLoaded(null)
    session.onStatus(status(PlayState.PLAYING, 10_000L))
    now += 2_000L
    assertEquals(13_000L, session.position())
    session.pause()
    now += 5_000L
    assertEquals(13_000L, session.position())
  }

  @Test
  fun pauseAndPlayGoToTheReceiver() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    assertEquals(listOf(Command.Pause), session.pause())
    assertEquals(emptyList<Command>(), session.pause())
    assertEquals(listOf(Command.Play), session.play())
    assertTrue(session.playWhenReady)
  }

  @Test
  fun aPauseOnTheSpeakerItselfIsFollowed() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    session.onStatus(status(PlayState.PAUSED, 1_500L))
    assertFalse(session.playWhenReady)
    assertEquals(Phase.READY, session.phase)
  }

  @Test
  fun playAfterTheReceiverStoppedLoadsTheFileAgainAtThePlace() {
    started()
    session.onStatus(status(PlayState.PLAYING, 20_000L))
    session.onStatus(status(PlayState.IDLE))
    assertEquals(Phase.IDLE, session.phase)
    assertEquals(listOf(Command.Load(0, 20_000L, true, 1f)), session.play())
  }

  @Test
  fun seekWithinThePartSeeksAndAcrossPartsLoads() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    assertEquals(listOf(Command.Seek(30_000L)), session.seek(0, 30_000L))
    assertEquals(listOf(Command.Load(2, 4_000L, true, 1f)), session.seek(2, 4_000L))
  }

  @Test
  fun aSpeedTheReceiverCannotPlayFallsBackToOne() {
    speeds = setOf(1f)
    session.start(parts, 0, 0L, play = true, speed = 1.25f)
    assertEquals(1f, session.speed)
    assertEquals(1.25f, session.requestedSpeed)
    // Still 1x: nothing to tell the receiver.
    assertEquals(emptyList<Command>(), session.setSpeed(1.5f))
  }

  @Test
  fun aSpeedTheReceiverPlaysIsSent() {
    started()
    assertEquals(listOf(Command.SetSpeed(1.5f)), session.setSpeed(1.5f))
    assertEquals(listOf(Command.SetSpeed(1f)), session.setSpeed(2f))
  }

  @Test
  fun aFailedLoadStopsAndSaysWhy() {
    session.start(parts, 0, 0L, play = true, speed = 1f)
    session.onLoaded("Kitchen could not play this file")
    assertEquals(Phase.IDLE, session.phase)
    assertFalse(session.playWhenReady)
    assertEquals("Kitchen could not play this file", session.error)
  }

  @Test
  fun theReceiversVolumeIsKept() {
    started()
    session.onStatus(status(PlayState.PLAYING, 0L, volume = 0.4f))
    session.onStatus(status(PlayState.PLAYING, 1_000L, volume = null))
    assertEquals(0.4f, session.volume)
  }
}

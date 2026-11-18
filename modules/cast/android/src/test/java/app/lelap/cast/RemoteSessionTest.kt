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
  private val timings = mutableListOf<RemoteSession.Timing>()
  private val session = RemoteSession({ now }, { it in speeds }, { timings += it })
  private val parts = listOf(60_000L, 60_000L, 60_000L)

  private fun status(state: PlayState, positionMs: Long = 0L, volume: Float? = null) =
    RendererStatus(state, positionMs, 60_000L, volume)

  private fun seqOf(commands: List<Command>): Int = (commands.single() as Command.Load).seq

  /** Loaded, and long enough ago that the receiver's statuses count again. */
  private fun started(index: Int = 0, positionMs: Long = 0L) {
    val commands = session.start(parts, index, positionMs, play = true, speed = 1f)
    session.onLoaded(seqOf(commands), null)
    settle()
  }

  private fun settle() {
    now += 10_000L
  }

  @Test
  fun startLoadsThePartAtThePlaceAndPlays() {
    val commands = session.start(parts, 1, 12_000L, play = true, speed = 1.5f)
    assertEquals(listOf(Command.Load(1, 12_000L, true, 1.5f, 1)), commands)
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
  fun aStopRightAfterALoadIsTheReceiverStartingNotAPause() {
    val load = session.start(parts, 0, 0L, play = true, speed = 1f)
    session.onLoaded(seqOf(load), null)
    session.onStatus(status(PlayState.IDLE))
    assertTrue(session.playWhenReady)
    assertEquals(Phase.BUFFERING, session.phase)
    session.onStatus(status(PlayState.PLAYING, 500L))
    assertEquals(Phase.READY, session.phase)
  }

  @Test
  fun aLoadThatANewerOneReplacedIsIgnored() {
    val first = session.start(parts, 0, 0L, play = true, speed = 1f)
    val second = session.seek(2, 0L)
    assertFalse(session.onLoaded(seqOf(first), "Kitchen could not play this file"))
    assertTrue(session.playWhenReady)
    assertTrue(session.onLoaded(seqOf(second), null))
  }

  @Test
  fun aPartThatEndsLoadsTheNextOnce() {
    started()
    session.onStatus(status(PlayState.PLAYING, 59_000L))
    val next = session.onStatus(status(PlayState.ENDED))
    assertEquals(1, (next.single() as Command.Load).index)
    // Receivers may say "ended" again before the load is done.
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.ENDED)))
    assertEquals(1, session.index)
  }

  @Test
  fun aStopMidPartIsNotItsEnd() {
    started()
    session.onStatus(status(PlayState.PLAYING, 20_000L))
    // A TV's stop button looks like the end of the file to the protocol.
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.ENDED)))
    assertEquals(0, session.index)
    assertEquals(Phase.IDLE, session.phase)
    assertFalse(session.playWhenReady)
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
    session.onStatus(status(PlayState.PLAYING, 59_500L))
    session.onStatus(status(PlayState.ENDED))
    val next = session.start(listOf(30_000L), 0, 5_000L, play = true, speed = 1f)
    assertEquals(Command.Load(0, 5_000L, true, 1f, 2), next.single())
    assertEquals(Phase.BUFFERING, session.phase)
  }

  @Test
  fun thePlaceMovesOnAtTheSpeedWhilePlaying() {
    val load = session.start(parts, 0, 0L, play = true, speed = 1.5f)
    session.onLoaded(seqOf(load), null)
    settle()
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
  fun aPollFromBeforeAPauseDoesNotUndoIt() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    session.pause()
    session.onStatus(status(PlayState.PLAYING, 1_200L))
    assertFalse(session.playWhenReady)
    settle()
    session.onStatus(status(PlayState.PAUSED, 1_100L))
    assertFalse(session.playWhenReady)
  }

  @Test
  fun aPollFromBeforeASeekDoesNotMoveThePlaceBack() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    session.seek(0, 40_000L)
    session.onStatus(status(PlayState.PLAYING, 1_500L))
    assertTrue(session.position() >= 40_000L)
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
    val again = session.play().single() as Command.Load
    assertEquals(0, again.index)
    assertEquals(20_000L, again.positionMs)
    assertTrue(again.autoplay)
  }

  @Test
  fun seekWithinThePartSeeksAndAcrossPartsLoads() {
    started()
    session.onStatus(status(PlayState.PLAYING, 1_000L))
    assertEquals(listOf(Command.Seek(30_000L)), session.seek(0, 30_000L))
    val across = session.seek(2, 4_000L).single() as Command.Load
    assertEquals(2, across.index)
    assertEquals(4_000L, across.positionMs)
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
    val load = session.start(parts, 0, 0L, play = true, speed = 1f)
    session.onLoaded(seqOf(load), "Kitchen could not play this file")
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

  // Smart rewind on a receiver (M69): one seek before Play, so it buffers once and never plays a
  // moment at the old place first.
  @Test
  fun playFromARewoundPlaceSeeksFirstThenPlays() {
    started()
    session.onStatus(status(PlayState.PLAYING, 30_000L))
    session.pause()
    settle()
    session.onStatus(status(PlayState.PAUSED, 30_000L))
    assertEquals(listOf(Command.Seek(25_000L), Command.Play), session.play(resumeAtMs = 25_000L))
    assertEquals(25_000L, session.position())
    assertEquals(listOf(Command.Play), session.play())
  }

  @Test
  fun aStoppedReceiverLoadsTheRewoundPlaceOnce() {
    started()
    session.onStatus(status(PlayState.PLAYING, 30_000L))
    settle()
    // Stopped on the speaker: Play loads the file again.
    session.onStatus(status(PlayState.IDLE, 0L))
    val commands = session.play(resumeAtMs = 25_000L)
    assertEquals(25_000L, (commands.single() as Command.Load).positionMs)
  }

  // A podcast's outro on a receiver (M45, M69).
  @Test
  fun reachingTheOutroInTheLastPartEndsTheEpisode() {
    val load = session.start(parts, 2, 40_000L, play = true, speed = 1f, outroAtMs = 50_000L)
    session.onLoaded(seqOf(load), null)
    settle()
    session.onStatus(status(PlayState.PLAYING, 49_000L))
    assertEquals(Phase.READY, session.phase)
    assertEquals(listOf(Command.Pause), session.onStatus(status(PlayState.PLAYING, 50_200L)))
    assertEquals(Phase.ENDED, session.phase)
    assertFalse(session.playWhenReady)
    assertEquals(60_000L, session.position())
    // The receiver's pause, coming in after, doesn't bring the episode back.
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.PAUSED, 50_300L)))
    assertEquals(Phase.ENDED, session.phase)
  }

  @Test
  fun theOutroOnlyCountsInTheLastPart() {
    val load = session.start(parts, 1, 40_000L, play = true, speed = 1f, outroAtMs = 50_000L)
    session.onLoaded(seqOf(load), null)
    settle()
    session.onStatus(status(PlayState.PLAYING, 49_000L))
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.PLAYING, 51_000L)))
    assertEquals(Phase.READY, session.phase)
  }

  @Test
  fun aListenerWhoSeeksPastTheOutroHearsIt() {
    val load = session.start(parts, 2, 40_000L, play = true, speed = 1f, outroAtMs = 50_000L)
    session.onLoaded(seqOf(load), null)
    settle()
    session.onStatus(status(PlayState.PLAYING, 41_000L))
    session.seek(2, 55_000L)
    settle()
    assertEquals(emptyList<Command>(), session.onStatus(status(PlayState.PLAYING, 56_000L)))
    assertEquals(Phase.READY, session.phase)
    // Back before it, and playing on: skipped again.
    session.seek(2, 45_000L)
    settle()
    session.onStatus(status(PlayState.PLAYING, 49_500L))
    assertEquals(listOf(Command.Pause), session.onStatus(status(PlayState.PLAYING, 50_500L)))
  }

  @Test
  fun anOutroSetWhilePlayingApplies() {
    started(index = 2, positionMs = 40_000L)
    session.onStatus(status(PlayState.PLAYING, 45_000L))
    session.setOutro(50_000L)
    assertEquals(listOf(Command.Pause), session.onStatus(status(PlayState.PLAYING, 50_000L)))
    session.setOutro(null)
  }

  // M51: a receiver that drops off without a word doesn't keep adding listening time.
  @Test
  fun thePlaceStopsMovingSoonAfterTheReceiverFallsSilent() {
    started()
    session.onStatus(status(PlayState.PLAYING, 10_000L))
    now += 1_000L
    assertEquals(11_000L, session.position())
    now += 60_000L
    assertEquals(13_000L, session.position())
    // It speaks again: the place goes on from its word, not from the silence.
    session.onStatus(status(PlayState.PLAYING, 13_500L))
    now += 1_000L
    assertEquals(14_500L, session.position())
  }

  // M69: how long receivers take, measured so the waits can be tuned on real ones.
  @Test
  fun measuresHowLongTheReceiverTakesToAgree() {
    started()
    session.onStatus(status(PlayState.PLAYING, 10_000L))
    timings.clear()
    session.pause()
    now += 800L
    session.onStatus(status(PlayState.PLAYING, 10_800L))
    now += 900L
    session.onStatus(status(PlayState.PAUSED, 10_900L))
    assertEquals(listOf(RemoteSession.Timing("pause", 1_700L)), timings)
    timings.clear()
    session.seek(0, 40_000L)
    now += 1_000L
    session.onStatus(status(PlayState.PAUSED, 10_900L))
    now += 1_500L
    session.onStatus(status(PlayState.PAUSED, 40_100L))
    assertEquals(listOf(RemoteSession.Timing("seek", 2_500L)), timings)
  }

  @Test
  fun measuresHowFarBeforeThePartsEndTheReceiverStops() {
    started()
    session.onStatus(status(PlayState.PLAYING, 58_000L))
    timings.clear()
    now += 500L
    session.onStatus(status(PlayState.ENDED))
    assertEquals(listOf(RemoteSession.Timing("part-end", 1_500L)), timings)
  }
}

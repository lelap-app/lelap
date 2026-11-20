package app.lelap.cast

import app.lelap.cast.RemoteSession.Timing
import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiverWaitsTest {
  @Test
  fun theDefaultsHoldUntilTheReceiverAnsweredAFewTimes() {
    val waits = ReceiverWaits()
    waits.learn(Timing("play", 300L))
    waits.learn(Timing("pause", 300L))
    assertEquals(2_500L, waits.commandSettleMs)
    assertEquals(5_000L, waits.loadSettleMs)
  }

  @Test
  fun aQuickSpeakerGetsShorterWaitsButNeverUnderTwoPolls() {
    val waits = ReceiverWaits()
    repeat(5) { waits.learn(Timing("seek", 200L)) }
    assertEquals(1_500L, waits.commandSettleMs)
    repeat(4) { waits.learn(Timing("load", 1_200L)) }
    assertEquals(2_800L, waits.loadSettleMs)
  }

  @Test
  fun aSlowSpeakerGetsLongerWaitsFromItsSlowerAnswers() {
    val waits = ReceiverWaits()
    listOf(900L, 1_000L, 1_100L, 1_200L, 1_300L, 1_400L, 1_500L, 1_600L, 1_700L, 4_000L).forEach {
      waits.learn(Timing("play", it))
    }
    // The 90th percentile is 1.7 s: half again and a poll.
    assertEquals(3_550L, waits.commandSettleMs)
    repeat(3) { waits.learn(Timing("load", 20_000L)) }
    assertEquals(15_000L, waits.loadSettleMs)
  }

  @Test
  fun partEndsAndStopsTuneNothing() {
    val waits = ReceiverWaits()
    repeat(5) { waits.learn(Timing("part-end", 100L)) }
    repeat(5) { waits.learn(Timing("stop", 100L)) }
    assertEquals(2_500L, waits.commandSettleMs)
  }
}

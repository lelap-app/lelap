package app.lelap.cast

import app.lelap.cast.GroupSync.Action
import org.junit.Assert.assertEquals
import org.junit.Test

class GroupSyncTest {
  private var now = 100_000L
  private val sync = GroupSync { now }

  private fun status(state: PlayState, positionMs: Long) = RendererStatus(state, positionMs, 600_000L, null)

  private fun playing(positionMs: Long) = status(PlayState.PLAYING, positionMs)

  @Test
  fun speakersCloseTogetherAreLeftAlone() {
    assertEquals(emptyList<Action>(), sync.onStatuses(playing(10_000L), mapOf(0 to playing(10_900L), 1 to playing(9_200L))))
  }

  @Test
  fun aSpeakerThatDriftedIsMovedToTheFirstOnesPlace() {
    assertEquals(listOf(Action.Seek(0, 10_000L, -2_500L)), sync.onStatuses(playing(10_000L), mapOf(0 to playing(7_500L))))
  }

  @Test
  fun aSpeakerStillBehindAfterASeekIsAimedFurtherAhead() {
    sync.onStatuses(playing(10_000L), mapOf(0 to playing(7_500L)))
    // Within the cooldown nothing more is said.
    now += 2_000L
    assertEquals(emptyList<Action>(), sync.onStatuses(playing(12_000L), mapOf(0 to playing(10_200L))))
    // Still 1.5 s behind: the seek cost that much, so the next one aims 1.5 s ahead.
    now += 8_000L
    assertEquals(listOf(Action.Seek(0, 21_500L, -1_500L)), sync.onStatuses(playing(20_000L), mapOf(0 to playing(18_500L))))
  }

  @Test
  fun theLeadNeverGrowsPastItsLimit() {
    sync.onStatuses(playing(10_000L), mapOf(0 to playing(1_000L)))
    now += 9_000L
    val action = sync.onStatuses(playing(19_000L), mapOf(0 to playing(10_000L))).single() as Action.Seek
    assertEquals(19_000L + GroupSync.MAX_LEAD_MS, action.positionMs)
  }

  @Test
  fun aFollowerThatMissedPlayOrPauseIsToldAgain() {
    assertEquals(listOf(Action.Play(0)), sync.onStatuses(playing(5_000L), mapOf(0 to status(PlayState.PAUSED, 5_000L))))
    assertEquals(
      listOf(Action.Pause(1)),
      sync.onStatuses(status(PlayState.PAUSED, 5_000L), mapOf(1 to playing(5_000L))),
    )
  }

  @Test
  fun bufferingStoppedOrSilentSpeakersAreLeftToCatchUp() {
    val statuses = mapOf(0 to status(PlayState.BUFFERING, 0L), 1 to status(PlayState.IDLE, 0L), 2 to null)
    assertEquals(emptyList<Action>(), sync.onStatuses(playing(30_000L), statuses))
    // The first speaker buffering: nothing to keep step with.
    assertEquals(emptyList<Action>(), sync.onStatuses(status(PlayState.BUFFERING, 0L), mapOf(3 to playing(9_000L))))
  }

  @Test
  fun aGroupCommandHoldsCorrectionsWhileTheSpeakersCatchUp() {
    sync.commanded()
    assertEquals(emptyList<Action>(), sync.onStatuses(playing(10_000L), mapOf(0 to playing(2_000L))))
    now += GroupSync.COOLDOWN_MS
    assertEquals(1, sync.onStatuses(playing(18_000L), mapOf(0 to playing(10_000L))).size)
  }

  @Test
  fun groupVolumeKeepsEachSpeakersShare() {
    assertEquals(listOf(0.3f, 0.6f, 0.15f), groupVolumes(0.3f, listOf(0.4f, 0.8f, 0.2f)).map { Math.round(it * 100) / 100f })
    // A follower that would go past full stays at full.
    assertEquals(listOf(0.8f, 1f), groupVolumes(0.8f, listOf(0.4f, 0.6f)))
    // Without the first one's volume, all go to the level.
    assertEquals(listOf(0.5f, 0.5f), groupVolumes(0.5f, listOf(null, 0.9f)))
  }
}

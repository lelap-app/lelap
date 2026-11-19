package app.lelap.cast

import java.util.Collections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupRendererTest {
  private class Fake(val name: String, var status: RendererStatus, val fails: Boolean = false, val speeds: Set<Float> = setOf(1f, 1.5f)) : Renderer {
    val calls: MutableList<String> = Collections.synchronizedList(mutableListOf<String>())
    var closed = false

    private fun call(what: String) {
      calls += what
      if (fails) throw CastException("$name failed")
    }

    override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) = call("load $startMs")
    override fun play() = call("play")
    override fun pause() = call("pause")
    override fun seek(positionMs: Long) = call("seek $positionMs")
    override fun setSpeed(speed: Float) = call("speed $speed")
    override fun canPlayAt(speed: Float): Boolean = speed in speeds
    override fun setVolume(level: Float) = call("volume $level")
    var quiet = false

    override fun status(): RendererStatus = if (quiet) throw CastException("$name is quiet") else status
    override fun close() {
      closed = true
    }
  }

  private var now = 0L
  private val media = CastMedia("http://phone/1.mp3", "audio/mpeg", "Book", null, null, null, 60_000L)

  private fun playing(positionMs: Long, volume: Float? = null) = RendererStatus(PlayState.PLAYING, positionMs, 60_000L, volume)

  @Test
  fun commandsGoToEverySpeaker() {
    val leader = Fake("a", playing(0L))
    val follower = Fake("b", playing(0L))
    val group = GroupRenderer(leader, listOf(follower), { now }, {})
    group.load(media, 5_000L, autoplay = true, speed = 1f)
    group.pause()
    group.seek(9_000L)
    assertEquals(listOf("load 5000", "pause", "seek 9000"), leader.calls)
    assertEquals(listOf("load 5000", "pause", "seek 9000"), follower.calls)
  }

  @Test
  fun aFollowerThatFailsLeavesAndTheRestPlayOn() {
    val leader = Fake("a", playing(0L))
    val broken = Fake("b", playing(0L), fails = true)
    val group = GroupRenderer(leader, listOf(broken), { now }, {})
    group.load(media, 0L, autoplay = true, speed = 1f)
    assertEquals(0, group.followerCount)
    group.play()
    assertEquals(listOf("load 0", "play"), leader.calls)
    assertEquals(listOf("load 0"), broken.calls)
  }

  @Test(expected = CastException::class)
  fun aLeaderThatFailsFailsTheGroup() {
    GroupRenderer(Fake("a", playing(0L), fails = true), listOf(Fake("b", playing(0L))), { now }, {}).play()
  }

  @Test
  fun theGroupPlaysOnlyAtSpeedsEverySpeakerCan() {
    val group = GroupRenderer(Fake("a", playing(0L)), listOf(Fake("b", playing(0L), speeds = setOf(1f))), { now }, {})
    assertTrue(group.canPlayAt(1f))
    assertFalse(group.canPlayAt(1.5f))
  }

  @Test
  fun theFirstSpeakersStatusIsTheGroupsAndADriftedFollowerIsMoved() {
    val leader = Fake("a", playing(20_000L, volume = 0.5f))
    val follower = Fake("b", playing(17_000L, volume = 0.25f))
    val group = GroupRenderer(leader, listOf(follower), { now }, {})
    assertEquals(20_000L, group.status().positionMs)
    // The seek runs on the group's own threads.
    val deadline = System.currentTimeMillis() + 2_000L
    while (follower.calls.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertEquals(listOf("seek 20000"), follower.calls.toList())
    // The volume keeps each speaker's share.
    group.setVolume(1f)
    assertEquals("volume 1.0", leader.calls.last())
    val until = System.currentTimeMillis() + 2_000L
    while (follower.calls.size < 2 && System.currentTimeMillis() < until) Thread.sleep(10L)
    assertEquals("volume 0.5", follower.calls.last())
  }

  @Test
  fun aFollowerThatStopsAnsweringLeaves() {
    val follower = Fake("b", playing(0L)).apply { quiet = true }
    val group = GroupRenderer(Fake("a", playing(0L)), listOf(follower), { now }, {})
    repeat(GroupRenderer.SILENT_POLLS - 1) { group.status() }
    assertEquals(1, group.followerCount)
    group.status()
    assertEquals(0, group.followerCount)
  }

  @Test
  fun aFollowersCallsRunInOrder() {
    val follower = Fake("b", playing(0L))
    val group = GroupRenderer(Fake("a", playing(0L)), listOf(follower), { now }, {})
    repeat(20) { i -> group.seek(i * 1_000L) }
    assertEquals((0 until 20).map { "seek ${it * 1_000L}" }, follower.calls.toList())
  }

  @Test
  fun aSpeakerThatJoinsLoadsFirstThenFollowsEveryCommand() {
    val leader = Fake("a", playing(0L))
    val group = GroupRenderer(leader, emptyList(), { now }, {})
    val joining = Fake("b", playing(0L))
    val loaded = group.add(joining) { it.load(media, 12_000L, true, 1f) }
    group.pause()
    loaded!!.get()
    assertEquals(1, group.followerCount)
    val deadline = System.currentTimeMillis() + 2_000L
    while (joining.calls.size < 2 && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertEquals(listOf("load 12000", "pause"), joining.calls.toList())
  }

  @Test
  fun aSpeakerWhoseLoadFailsLeavesAndIsReported() {
    val left = mutableListOf<Renderer>()
    val group = GroupRenderer(Fake("a", playing(0L)), emptyList(), { now }, {}, onLeft = { left += it })
    val broken = Fake("b", playing(0L), fails = true)
    val loaded = group.add(broken) { it.load(media, 0L, true, 1f) }
    assertTrue(runCatching { loaded!!.get() }.isFailure)
    assertEquals(0, group.followerCount)
    assertEquals(listOf<Renderer>(broken), left)
  }

  @Test
  fun duringAFadeASpeakerThatJoinsIsLoweredAndGetsItsVolumeBackWhenTakenOut() {
    val group = GroupRenderer(Fake("a", playing(0L, volume = 0.3f)), emptyList(), { now }, {})
    group.scale = 0.5f
    val joining = Fake("b", playing(0L, volume = 0.4f))
    group.add(joining) { it.load(media, 0L, true, 1f) }!!.get()
    assertEquals(listOf("load 0", "volume 0.2"), joining.calls.toList())
    group.remove(joining)
    val deadline = System.currentTimeMillis() + 2_000L
    while (!joining.closed && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertEquals("volume 0.4", joining.calls.last())
  }

  @Test
  fun aSpeakerTakenOutStopsWithoutBeingReportedAsLost() {
    val left = mutableListOf<Renderer>()
    val follower = Fake("b", playing(0L))
    val group = GroupRenderer(Fake("a", playing(0L)), listOf(follower), { now }, {}, onLeft = { left += it })
    group.remove(follower)
    assertEquals(0, group.followerCount)
    assertTrue(left.isEmpty())
    val deadline = System.currentTimeMillis() + 2_000L
    while (!follower.closed && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertTrue(follower.closed)
  }

  @Test
  fun aSpeakerThatJoinsIsGivenTimeToLoadBeforeItIsKeptInStep() {
    val leader = Fake("a", playing(30_000L))
    val group = GroupRenderer(leader, emptyList(), { now }, {})
    val joining = Fake("b", RendererStatus(PlayState.PAUSED, 0L, 60_000L, null))
    group.add(joining, null)
    group.status()
    Thread.sleep(100L)
    assertTrue(joining.calls.isEmpty())
    now += GroupSync.COOLDOWN_MS + 1
    group.status()
    val deadline = System.currentTimeMillis() + 2_000L
    while (joining.calls.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertEquals(listOf("play"), joining.calls.toList())
  }

  @Test
  fun aLostFollowerIsDroppedAndClosed() {
    val follower = Fake("b", playing(0L))
    val group = GroupRenderer(Fake("a", playing(0L)), listOf(follower), { now }, {})
    group.drop(follower)
    assertEquals(0, group.followerCount)
    val deadline = System.currentTimeMillis() + 2_000L
    while (!follower.closed && System.currentTimeMillis() < deadline) Thread.sleep(10L)
    assertTrue(follower.closed)
  }
}

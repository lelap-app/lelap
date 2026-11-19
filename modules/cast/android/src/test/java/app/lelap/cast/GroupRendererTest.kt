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
    override fun status(): RendererStatus = status
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
    assertEquals("volume 0.5", follower.calls.last())
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

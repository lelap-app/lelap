package app.lelap.cast

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FCastTest {
  @Test
  fun framesWithALittleEndianSizeThatCountsTheOpcode() {
    assertArrayEquals(byteArrayOf(1, 0, 0, 0, 2), FCastProtocol.frame(FCastProtocol.PAUSE))
    val frame = FCastProtocol.frame(FCastProtocol.SEEK, "{\"time\":1.5}")
    assertEquals(13, frame[0].toInt())
    assertEquals(FCastProtocol.SEEK, frame[4].toInt())
  }

  @Test
  fun readsWhatItWrites() {
    val stream = FCastProtocol.frame(FCastProtocol.PING) + FCastProtocol.frame(FCastProtocol.PLAYBACK_UPDATE, "{\"time\":3,\"state\":1}")
    val input = DataInputStream(ByteArrayInputStream(stream))
    val ping = FCastProtocol.read(input)
    assertEquals(FCastProtocol.PING, ping.opcode)
    assertNull(ping.body)
    val update = FCastProtocol.read(input)
    assertEquals(FCastProtocol.PLAYBACK_UPDATE, update.opcode)
    assertEquals(1, JSONObject(update.body!!).getInt("state"))
  }

  @Test
  fun playCarriesTypeUrlTimeAndSpeed() {
    val media = CastMedia("http://p/t/media.mp3", "audio/mpeg", "t", null, null, null, 0)
    val play = JSONObject(FCastProtocol.play(media, 90_000, 1.25f))
    assertEquals("audio/mpeg", play.getString("container"))
    assertEquals("http://p/t/media.mp3", play.getString("url"))
    assertEquals(90.0, play.getDouble("time"), 0.0)
    assertEquals(1.25, play.getDouble("speed"), 0.0)
  }

  @Test
  fun mapsStates() {
    assertEquals(PlayState.IDLE, FCastProtocol.playState(0))
    assertEquals(PlayState.PLAYING, FCastProtocol.playState(1))
    assertEquals(PlayState.PAUSED, FCastProtocol.playState(2))
  }

  /** Polls once a second from [from] to [to], as the cast thread does; true if any said lost. */
  private fun pollEverySecond(watch: FCastWatch, from: Long, to: Long): Boolean {
    var lost = false
    var t = from
    while (t <= to) {
      if (watch.polled(t)) lost = true
      t += 1_000L
    }
    return lost
  }

  @Test
  fun aReceiverThatNeverAnswersAPingIsNotHeldToSilence() {
    val watch = FCastWatch(0L)
    watch.heard(1_000L, pong = false)
    assertEquals(60_000L, watch.placeUntil(60_000L))
    assertFalse(pollEverySecond(watch, 1_000L, 60_000L))
  }

  @Test
  fun aReceiverThatAnswersPingsStopsMovingSoonAfterItFallsSilent() {
    val watch = FCastWatch(0L)
    watch.heard(3_000L, pong = true)
    assertEquals(4_000L, watch.placeUntil(4_000L))
    assertEquals(6_000L, watch.placeUntil(20_000L))
  }

  @Test
  fun aReceiverThatAnswersPingsIsLostOnceAfterFifteenQuietSeconds() {
    val watch = FCastWatch(0L)
    watch.heard(3_000L, pong = true)
    assertFalse(pollEverySecond(watch, 1_000L, 18_000L))
    assertTrue(watch.polled(19_000L))
    assertFalse(watch.polled(20_000L))
  }

  @Test
  fun anyPacketKeepsItAlive() {
    val watch = FCastWatch(0L)
    watch.heard(3_000L, pong = true)
    var t = 4_000L
    while (t < 60_000L) {
      if (t % 5_000L == 0L) watch.heard(t, pong = false)
      assertFalse(watch.polled(t))
      t += 1_000L
    }
  }

  @Test
  fun aLatePollIsNotSilence() {
    val watch = FCastWatch(0L)
    watch.heard(3_000L, pong = true)
    assertFalse(pollEverySecond(watch, 1_000L, 10_000L))
    // The phone slept for a minute: the receiver gets a fresh chance.
    assertFalse(watch.polled(70_000L))
    assertFalse(pollEverySecond(watch, 71_000L, 85_000L))
    assertTrue(watch.polled(86_000L))
  }
}

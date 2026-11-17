package app.lelap.cast

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}

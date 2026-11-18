package app.lelap.cast

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CastMessageTest {
  private val connect = CastMessage("sender-0", "receiver-0", CastJson.CONNECTION, "{\"type\":\"CONNECT\"}")

  @Test
  fun encodesFieldsInProtobufOrder() {
    val bytes = CastMessage.encode(CastMessage("s", "r", "n", "p"))
    val expected = byteArrayOf(
      0x08, 0x00, // protocol_version = CASTV2_1_0
      0x12, 0x01, 's'.code.toByte(), // source_id
      0x1a, 0x01, 'r'.code.toByte(), // destination_id
      0x22, 0x01, 'n'.code.toByte(), // namespace
      0x28, 0x00, // payload_type = STRING
      0x32, 0x01, 'p'.code.toByte(), // payload_utf8
    )
    assertArrayEquals(expected, bytes)
  }

  @Test
  fun lengthsOver127UseTwoByteVarints() {
    val payload = "x".repeat(300)
    val bytes = CastMessage.encode(CastMessage("s", "r", "n", payload))
    // 300 = 0b10_0101100 → 0xac 0x02
    assertEquals(0x32.toByte(), bytes[13])
    assertEquals(0xac.toByte(), bytes[14])
    assertEquals(0x02.toByte(), bytes[15])
    assertEquals(payload, CastMessage.decode(bytes)!!.payload)
  }

  @Test
  fun framesWithABigEndianLength() {
    val frame = CastMessage.frame(connect)
    val body = CastMessage.encode(connect)
    assertEquals(body.size + 4, frame.size)
    assertEquals(0, frame[0].toInt())
    assertEquals(0, frame[1].toInt())
    assertEquals(0, frame[2].toInt())
    assertEquals(body.size, frame[3].toInt())
    assertEquals(connect, CastMessage.read(DataInputStream(ByteArrayInputStream(frame))))
  }

  @Test
  fun decodesUtf8AndSkipsUnknownFields() {
    val message = CastMessage("søren", "receiver-0", CastJson.MEDIA, "{\"title\":\"Één\"}")
    val withExtra = CastMessage.encode(message) + byteArrayOf(0x48, 0x05, 0x55, 0x01, 0x02, 0x03, 0x04)
    assertEquals(message, CastMessage.decode(withExtra))
  }

  @Test
  fun refusesTruncatedMessages() {
    val bytes = CastMessage.encode(connect)
    assertNull(CastMessage.decode(bytes.copyOf(bytes.size - 3)))
    // No payload of either kind.
    assertNull(CastMessage.decode(byteArrayOf(0x12, 0x01, 0x73, 0x1a, 0x01, 0x72, 0x22, 0x01, 0x6e)))
  }

  @Test
  fun binaryPayloadsRoundTripWithPayloadTypeBinary() {
    val auth = CastMessage("sender-0", "receiver-0", CastAuth.NAMESPACE, "", byteArrayOf(0x0a, 0x00))
    val bytes = CastMessage.encode(auth)
    // payload_type = BINARY, then payload_binary.
    assertArrayEquals(byteArrayOf(0x28, 0x01, 0x3a, 0x02, 0x0a, 0x00), bytes.copyOfRange(bytes.size - 6, bytes.size))
    val decoded = CastMessage.decode(bytes)!!
    assertEquals("", decoded.payload)
    assertArrayEquals(byteArrayOf(0x0a, 0x00), decoded.binary)
    // payload_binary only, as a receiver sends it.
    val bare = CastMessage.decode(byteArrayOf(0x12, 0x01, 0x73, 0x1a, 0x01, 0x72, 0x22, 0x01, 0x6e, 0x3a, 0x01, 0x00))!!
    assertArrayEquals(byteArrayOf(0x00), bare.binary)
  }

  @Test
  fun skipsBinaryFramesWhenReading() {
    val binary = byteArrayOf(0x12, 0x01, 0x73, 0x3a, 0x01, 0x00)
    val stream = byteArrayOf(0, 0, 0, binary.size.toByte()) + binary + CastMessage.frame(connect)
    assertEquals(connect, CastMessage.read(DataInputStream(ByteArrayInputStream(stream))))
  }

  @Test
  fun buildsALoadForTheDefaultMediaReceiver() {
    val media = CastMedia("http://192.168.1.4:40000/abc/media.m4b", "audio/mp4", "Part 1", "Author", "Book", "https://covers/x.jpg", 600_000)
    val load = JSONObject(CastJson.load(7, media, 61_500, true, 1.5f))
    assertEquals("LOAD", load.getString("type"))
    assertEquals(7, load.getInt("requestId"))
    assertEquals(61.5, load.getDouble("currentTime"), 0.0)
    assertEquals(1.5, load.getDouble("playbackRate"), 0.0)
    val item = load.getJSONObject("media")
    assertEquals("http://192.168.1.4:40000/abc/media.m4b", item.getString("contentId"))
    assertEquals("audio/mp4", item.getString("contentType"))
    assertEquals("BUFFERED", item.getString("streamType"))
    assertEquals(600.0, item.getDouble("duration"), 0.0)
    val metadata = item.getJSONObject("metadata")
    assertEquals(3, metadata.getInt("metadataType"))
    assertEquals("Book", metadata.getString("albumName"))
    assertEquals("https://covers/x.jpg", metadata.getJSONArray("images").getJSONObject(0).getString("url"))
  }

  @Test
  fun readsReceiverAndMediaStatus() {
    val receiver = """{"type":"RECEIVER_STATUS","requestId":1,"status":{"applications":[
      {"appId":"CC1AD845","sessionId":"s-1","transportId":"t-1","displayName":"Default Media Receiver"}],
      "volume":{"level":0.4,"muted":false}}}"""
    val status = CastJson.receiverStatus(receiver)!!
    assertEquals(CastJson.App("s-1", "t-1"), status.app)
    assertEquals(0.4f, status.volume!!, 0.0001f)
    assertNull(CastJson.receiverStatus("""{"type":"RECEIVER_STATUS","status":{"applications":[{"appId":"OTHER","sessionId":"a","transportId":"b"}]}}""")!!.app)

    val media = """{"type":"MEDIA_STATUS","status":[{"mediaSessionId":3,"playbackRate":1.25,"playerState":"PLAYING",
      "currentTime":12.5,"media":{"duration":600.0}}],"requestId":0}"""
    val m = CastJson.mediaStatus(media)!!
    assertEquals(3, m.mediaSessionId)
    assertEquals(12_500L, m.currentTimeMs)
    assertEquals(600_000L, m.durationMs)
    assertEquals(1.25f, m.playbackRate, 0.0001f)
    assertEquals(PlayState.PLAYING, CastJson.playState(m))
    assertNull(CastJson.mediaStatus("""{"type":"MEDIA_STATUS","status":[]}"""))

    val finished = CastJson.mediaStatus("""{"status":[{"mediaSessionId":3,"playerState":"IDLE","idleReason":"FINISHED"}]}""")
    assertEquals(PlayState.ENDED, CastJson.playState(finished))
    val cancelled = CastJson.mediaStatus("""{"status":[{"mediaSessionId":3,"playerState":"IDLE","idleReason":"CANCELLED"}]}""")
    assertEquals(PlayState.IDLE, CastJson.playState(cancelled))
  }
}

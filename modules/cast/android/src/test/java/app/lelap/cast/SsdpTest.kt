package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SsdpTest {
  @Test
  fun searchAsksForMediaRenderers() {
    val message = Ssdp.searchMessage()
    assertTrue(message.startsWith("M-SEARCH * HTTP/1.1\r\n"))
    assertTrue(message.contains("MAN: \"ssdp:discover\"\r\n"))
    assertTrue(message.contains("ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n"))
    assertTrue(message.endsWith("\r\n\r\n"))
  }

  @Test
  fun readsASonosAnswer() {
    val answer = "HTTP/1.1 200 OK\r\n" +
      "CACHE-CONTROL: max-age = 1800\r\n" +
      "EXT:\r\n" +
      "LOCATION: http://192.168.1.20:1400/xml/device_description.xml\r\n" +
      "SERVER: Linux UPnP/1.0 Sonos/80.1-55014 (ZPS27)\r\n" +
      "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n" +
      "USN: uuid:RINCON_000E58A0B1C201400_MR::urn:schemas-upnp-org:device:MediaRenderer:1\r\n" +
      "\r\n"
    val parsed = Ssdp.parseResponse(answer)!!
    assertEquals("http://192.168.1.20:1400/xml/device_description.xml", parsed.location)
    assertEquals("urn:schemas-upnp-org:device:MediaRenderer:1", parsed.st)
    assertEquals("uuid:RINCON_000E58A0B1C201400_MR", Ssdp.uuidOf(parsed.usn))
  }

  @Test
  fun headerNamesAreCaseInsensitiveAndLfIsEnough() {
    val parsed = Ssdp.parseResponse("HTTP/1.1 200 OK\nLocation: http://10.0.0.5:49152/desc.xml\nusn: uuid:tv\n\n")!!
    assertEquals("http://10.0.0.5:49152/desc.xml", parsed.location)
    assertEquals("uuid:tv", Ssdp.uuidOf(parsed.usn))
  }

  @Test
  fun readsAliveNoticesButNotByeBye() {
    val alive = "NOTIFY * HTTP/1.1\r\nNT: urn:schemas-upnp-org:device:MediaRenderer:1\r\nNTS: ssdp:alive\r\n" +
      "LOCATION: http://10.0.0.7:8080/dd.xml\r\nUSN: uuid:x::y\r\n\r\n"
    assertEquals("http://10.0.0.7:8080/dd.xml", Ssdp.parseResponse(alive)!!.location)
    assertNull(Ssdp.parseResponse(alive.replace("ssdp:alive", "ssdp:byebye")))
  }

  @Test
  fun ignoresSearchesAndAnswersWithoutHttpLocation() {
    assertNull(Ssdp.parseResponse(Ssdp.searchMessage()))
    assertNull(Ssdp.parseResponse("HTTP/1.1 200 OK\r\nLOCATION: https://evil/\r\n\r\n"))
    assertNull(Ssdp.parseResponse("HTTP/1.1 200 OK\r\nST: x\r\n\r\n"))
    assertNull(Ssdp.parseResponse(""))
  }
}

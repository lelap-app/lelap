package app.lelap.cast

import app.lelap.text.NativeCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpnpTest {
  private val sonos = """<?xml version="1.0" encoding="utf-8" ?>
    <root xmlns="urn:schemas-upnp-org:device-1-0">
      <specVersion><major>1</major><minor>0</minor></specVersion>
      <device>
        <deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType>
        <friendlyName>192.168.1.20 - Sonos One - RINCON_000E58A0B1C201400</friendlyName>
        <manufacturer>Sonos, Inc.</manufacturer>
        <modelName>Sonos One</modelName>
        <UDN>uuid:RINCON_000E58A0B1C201400</UDN>
        <roomName>Kitchen</roomName>
        <serviceList>
          <service>
            <serviceType>urn:schemas-upnp-org:service:AlarmClock:1</serviceType>
            <controlURL>/AlarmClock/Control</controlURL>
          </service>
        </serviceList>
        <deviceList>
          <device>
            <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
            <friendlyName>Kitchen - Sonos One Media Renderer</friendlyName>
            <serviceList>
              <service>
                <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
                <controlURL>/MediaRenderer/RenderingControl/Control</controlURL>
              </service>
              <service>
                <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
                <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
              </service>
            </serviceList>
          </device>
        </deviceList>
      </device>
    </root>"""

  @Test
  fun findsServicesInEmbeddedDevicesAndTheSonosRoomName() {
    val d = Upnp.parseDescription(sonos, "http://192.168.1.20:1400/xml/device_description.xml")!!
    assertEquals("Kitchen", d.name)
    assertEquals("uuid:RINCON_000E58A0B1C201400", d.udn)
    assertEquals("Sonos One", d.model)
    assertEquals("http://192.168.1.20:1400/MediaRenderer/AVTransport/Control", d.avTransportUrl)
    assertEquals("http://192.168.1.20:1400/MediaRenderer/RenderingControl/Control", d.renderingControlUrl)
  }

  @Test
  fun resolvesRelativeControlUrlsAgainstUrlBase() {
    val tv = """<root><URLBase>http://10.0.0.9:9197/</URLBase><device>
      <friendlyName>Living room TV</friendlyName>
      <serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
      <controlURL>upnp/control/AVTransport1</controlURL></service></serviceList></device></root>"""
    val d = Upnp.parseDescription(tv, "http://10.0.0.9:9197/dmr")!!
    assertEquals("Living room TV", d.name)
    assertEquals("http://10.0.0.9:9197/upnp/control/AVTransport1", d.avTransportUrl)
    assertNull(d.renderingControlUrl)
  }

  @Test
  fun refusesDoctypesAndGarbage() {
    val evil = """<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>
      <root><device><friendlyName>&x;</friendlyName></device></root>"""
    assertNull(Upnp.parseDescription(evil, "http://h/"))
    assertNull(Upnp.parseDescription("not xml", "http://h/"))
    // Internal entities that expand (no SYSTEM): refused before parsing, on Android too.
    val laughs = """<?xml version="1.0"?><!doctype r [<!ENTITY a "aaaa">]><root><device><friendlyName>&a;</friendlyName></device></root>"""
    assertNull(Upnp.parseDescription(laughs, "http://h/"))
  }

  @Test
  fun envelopeEscapesArgumentsSoDidlTravelsAsText() {
    val media = CastMedia("http://p:1/t/media.mp3?a=1&b=2", "audio/mpeg", "Tom & Jerry", "A <B>", null, null, 3_723_000)
    val didl = Upnp.didl(media)
    assertTrue(didl.contains("<dc:title>Tom &amp; Jerry</dc:title>"))
    assertTrue(didl.contains("<upnp:artist>A &lt;B&gt;</upnp:artist>"))
    assertTrue(didl.contains("protocolInfo=\"http-get:*:audio/mpeg:*\" duration=\"1:02:03.000\""))
    assertTrue(didl.contains(">http://p:1/t/media.mp3?a=1&amp;b=2</res>"))
    assertFalse(didl.contains("upnp:album"))

    val envelope = Upnp.envelope(Upnp.AV_TRANSPORT, "SetAVTransportURI", listOf("InstanceID" to "0", "CurrentURIMetaData" to didl))
    assertTrue(envelope.contains("<u:SetAVTransportURI xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\">"))
    assertTrue(envelope.contains("<InstanceID>0</InstanceID>"))
    assertTrue(envelope.contains("&lt;dc:title&gt;Tom &amp;amp; Jerry&lt;/dc:title&gt;"))
  }

  @Test
  fun readsPositionInfo() {
    val xml = """<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>
      <u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <Track>1</Track><TrackDuration>0:45:10</TrackDuration><RelTime>0:01:02.500</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime>
      </u:GetPositionInfoResponse></s:Body></s:Envelope>"""
    val out = Upnp.parseResponse(xml, "GetPositionInfo")!!
    assertEquals(62_500L, Upnp.parseTime(out["RelTime"]))
    assertEquals(2_710_000L, Upnp.parseTime(out["TrackDuration"]))
    assertNull(Upnp.parseTime(out["AbsTime"]))
    assertNull(Upnp.parseResponse(xml, "GetTransportInfo"))
  }

  @Test
  fun readsFaults() {
    val fault = """<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>
      <faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>
      <UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>701</errorCode>
      <errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>"""
    assertEquals("701", Upnp.faultCode(fault))
    assertNull(Upnp.faultCode("<s:Envelope/>"))
  }

  @Test
  fun refusalsNameOnlyTheNumber() {
    val ms = NativeCatalog("ms", mapOf("The speaker answered HTTP {status}." to "Pembesar suara menjawab HTTP {status}."))
    assertEquals("The speaker refused the command (UPnP error 701).", Upnp.refusal("701", 500, NativeCatalog.ENGLISH))
    assertEquals("Pembesar suara menjawab HTTP 500.", Upnp.refusal(null, 500, ms))
  }

  @Test
  fun formatsAndMapsStates() {
    assertEquals("0:00:00", Upnp.formatTime(-5))
    assertEquals("10:00:01", Upnp.formatTime(36_001_999))
    assertEquals(PlayState.PLAYING, Upnp.playState("PLAYING"))
    assertEquals(PlayState.PAUSED, Upnp.playState("PAUSED_PLAYBACK"))
    assertEquals(PlayState.BUFFERING, Upnp.playState("TRANSITIONING"))
    assertEquals(PlayState.IDLE, Upnp.playState("STOPPED"))
    assertEquals(PlayState.IDLE, Upnp.playState(null))
  }

  // AVTransport's service description, trimmed to the parts that matter, as renderers that offer
  // more than 1x write it.
  private val scpdWithSpeeds = """<?xml version="1.0"?>
    <scpd xmlns="urn:schemas-upnp-org:service-1-0">
      <specVersion><major>1</major><minor>0</minor></specVersion>
      <serviceStateTable>
        <stateVariable sendEvents="no">
          <name>TransportState</name><dataType>string</dataType>
          <allowedValueList><allowedValue>STOPPED</allowedValue><allowedValue>PLAYING</allowedValue></allowedValueList>
        </stateVariable>
        <stateVariable sendEvents="no">
          <name>TransportPlaySpeed</name><dataType>string</dataType>
          <allowedValueList>
            <allowedValue>1</allowedValue>
            <allowedValue>1/2</allowedValue>
            <allowedValue>3/2</allowedValue>
            <allowedValue>2</allowedValue>
          </allowedValueList>
        </stateVariable>
      </serviceStateTable>
    </scpd>"""

  private val scpdOnlyOne = """<?xml version="1.0"?>
    <scpd xmlns="urn:schemas-upnp-org:service-1-0"><serviceStateTable>
      <stateVariable sendEvents="no"><name>TransportPlaySpeed</name><dataType>string</dataType>
        <allowedValueList><allowedValue>1</allowedValue></allowedValueList></stateVariable>
    </serviceStateTable></scpd>"""

  @Test
  fun readsTheAvTransportServiceDescriptionUrl() {
    val tv = """<root><device><friendlyName>Den</friendlyName><serviceList><service>
      <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
      <SCPDURL>/xml/AVTransport1.xml</SCPDURL>
      <controlURL>/AVTransport/ctrl</controlURL></service></serviceList></device></root>"""
    val d = Upnp.parseDescription(tv, "http://10.0.0.5:8080/desc.xml")!!
    assertEquals("http://10.0.0.5:8080/xml/AVTransport1.xml", d.avTransportScpdUrl)
  }

  @Test
  fun readsThePlaySpeedsARendererOffers() {
    assertEquals(listOf("1", "1/2", "3/2", "2"), Upnp.parseSpeeds(scpdWithSpeeds))
    assertEquals(listOf("1"), Upnp.parseSpeeds(scpdOnlyOne))
    assertEquals(listOf("1"), Upnp.parseSpeeds("<scpd/>"))
    assertEquals(listOf("1"), Upnp.parseSpeeds("not xml"))
  }

  @Test
  fun matchesTheBooksSpeedToTheRenderersSpelling() {
    val speeds = Upnp.parseSpeeds(scpdWithSpeeds)
    assertEquals("3/2", Upnp.speedArg(1.5f, speeds))
    assertEquals("2", Upnp.speedArg(2f, speeds))
    assertEquals("1", Upnp.speedArg(1f, speeds))
    assertNull(Upnp.speedArg(1.25f, speeds))
    assertNull(Upnp.speedArg(1.5f, Upnp.parseSpeeds(scpdOnlyOne)))
    assertEquals("1.5", Upnp.speedArg(1.5f, listOf("1", "1.5")))
    assertNull(Upnp.speedValue("1/0"))
    assertNull(Upnp.speedValue("fast"))
  }

  @Test
  fun aStopAfterPlayingIsTheEndButNotAfterAPause() {
    val ends = EndWatch()
    assertEquals(PlayState.IDLE, ends.map(PlayState.IDLE))
    assertEquals(PlayState.PLAYING, ends.map(PlayState.PLAYING))
    assertEquals(PlayState.ENDED, ends.map(PlayState.IDLE))
    assertEquals(PlayState.IDLE, ends.map(PlayState.IDLE))
    ends.map(PlayState.PLAYING)
    ends.map(PlayState.PAUSED)
    assertEquals(PlayState.IDLE, ends.map(PlayState.IDLE))
  }
}

package app.lelap.cast

import android.net.NetworkCapabilities.TRANSPORT_CELLULAR
import android.net.NetworkCapabilities.TRANSPORT_ETHERNET
import android.net.NetworkCapabilities.TRANSPORT_VPN
import android.net.NetworkCapabilities.TRANSPORT_WIFI
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaServerTest {
  @Test
  fun parsesRanges() {
    assertEquals(Ranges.Result.Full, Ranges.parse(null, 1000))
    assertEquals(Ranges.Result.Full, Ranges.parse("items=0-1", 1000))
    assertEquals(Ranges.Result.Full, Ranges.parse("bytes=0-1,5-6", 1000))
    assertEquals(Ranges.Result.Partial(0, 999), Ranges.parse("bytes=0-", 1000))
    assertEquals(Ranges.Result.Partial(100, 199), Ranges.parse("bytes=100-199", 1000))
    assertEquals(Ranges.Result.Partial(900, 999), Ranges.parse("bytes=900-5000", 1000))
    assertEquals(Ranges.Result.Partial(800, 999), Ranges.parse("bytes=-200", 1000))
    assertEquals(Ranges.Result.Partial(0, 999), Ranges.parse("bytes=-5000", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=1000-", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=500-100", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=-0", 1000))
  }

  @Test
  fun takesTheTypeFromTheFilesOwnNameWhenTheAddressHasNone() {
    // A Subsonic stream address, and a part downloaded before its name kept the extension.
    assertEquals("Book/03 Part.flac", Mime.nameFor("https://music.example/rest/stream?id=3&t=x", "Book/03 Part.flac"))
    assertEquals("Part.m4b", Mime.nameFor("042.audio", "Part.m4b"))
    // The address's own extension wins; an unknown file name changes nothing.
    assertEquals("https://a.example/p.mp3", Mime.nameFor("https://a.example/p.mp3", "p.flac"))
    assertEquals("https://a.example/stream", Mime.nameFor("https://a.example/stream", "notes.txt"))
    assertEquals("https://a.example/stream", Mime.nameFor("https://a.example/stream", null))
    assertEquals("audio/flac", Mime.audioOr(null, Mime.nameFor("https://music.example/rest/stream", "x.flac")))
  }

  @Test
  fun mapsM4bToATypeReceiversAccept() {
    assertEquals("audio/mp4", Mime.audio("/storage/emulated/0/Books/Dune.m4b"))
    assertEquals("audio/mp4", Mime.audio("Part.M4A"))
    assertEquals("audio/mpeg", Mime.audio("https://archive.org/download/x/part_01.mp3?a=b#t"))
    assertEquals("audio/ogg", Mime.audio("episode.opus"))
    assertEquals("audio/mpeg", Mime.audio("no-extension"))
    assertEquals("audio/mp4", Mime.audioOr("audio/x-m4b", "stream"))
    assertEquals("audio/flac", Mime.audioOr("audio/flac; charset=binary", "stream"))
    assertEquals("application/x-mpegurl", Mime.audioOr("application/vnd.apple.mpegurl", "live"))
    assertEquals("application/x-mpegurl", Mime.audioOr(null, "live.m3u8"))
    assertEquals("audio/mp4", Mime.audioOr("application/octet-stream", "book.m4b"))
    assertEquals("image/png", Mime.image("cover.PNG"))
    assertEquals("m4b", Mime.extension("content://x/document/primary%3ABooks%2FDune.m4b"))
  }

  @Test
  fun servesOnlyOnWifiOrEthernet() {
    fun net(vararg transports: Int, address: String) =
      ServerNetwork.Candidate(transports.toSet(), listOf(InetAddress.getByName("fe80::1"), InetAddress.getByName(address)))
    val wifi = net(TRANSPORT_WIFI, address = "192.168.1.5")
    val mobile = net(TRANSPORT_CELLULAR, address = "10.20.30.40")
    val vpn = net(TRANSPORT_VPN, address = "10.8.0.2")
    // A VPN on top of Wi-Fi: the Wi-Fi's own address, which receivers at home can reach.
    assertEquals(InetAddress.getByName("192.168.1.5"), ServerNetwork.pick(listOf(vpn, mobile, wifi)))
    assertEquals(InetAddress.getByName("10.0.0.9"), ServerNetwork.pick(listOf(net(TRANSPORT_ETHERNET, address = "10.0.0.9"))))
    // Mobile data or a VPN alone: nowhere to serve, so the app asks for the same Wi-Fi.
    assertNull(ServerNetwork.pick(listOf(mobile, vpn)))
    assertNull(ServerNetwork.pick(listOf(net(TRANSPORT_WIFI, TRANSPORT_VPN, address = "10.8.0.3"))))
  }
}

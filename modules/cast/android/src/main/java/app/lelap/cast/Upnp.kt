package app.lelap.cast

import app.lelap.text.NativeText
import java.io.StringReader
import java.net.URI
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.xml.sax.InputSource

/** Device descriptions, SOAP and DIDL-Lite for UPnP AV renderers. */
object Upnp {
  const val AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1"
  const val RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1"

  data class Description(
    val name: String,
    val udn: String?,
    val manufacturer: String?,
    val model: String?,
    val avTransportUrl: String?,
    val renderingControlUrl: String?,
    /** AVTransport's service description, which lists the play speeds the renderer takes. */
    val avTransportScpdUrl: String? = null,
  )

  /**
   * Reads a device description. Services are searched in embedded devices too: a Sonos speaker's
   * root device is a ZonePlayer with the MediaRenderer inside it.
   */
  fun parseDescription(xml: String, location: String): Description? {
    val doc = parse(xml) ?: return null
    val root = doc.documentElement
    val device = root.child("device") ?: return null
    val base = root.childText("URLBase")?.takeIf { it.isNotBlank() } ?: location
    var avTransport: String? = null
    var rendering: String? = null
    var avScpd: String? = null
    val services = doc.getElementsByTagName("service")
    for (i in 0 until services.length) {
      val service = services.item(i) as Element
      val type = service.childText("serviceType") ?: continue
      val control = service.childText("controlURL") ?: continue
      val url = resolve(base, control) ?: continue
      if (type.contains(":AVTransport:") && avTransport == null) {
        avTransport = url
        avScpd = service.childText("SCPDURL")?.let { resolve(base, it) }
      }
      if (type.contains(":RenderingControl:") && rendering == null) rendering = url
    }
    // Sonos names the room separately; its friendlyName is an IP address and a model.
    val name = device.childText("roomName") ?: device.childText("friendlyName") ?: return null
    return Description(
      name = name.trim(),
      udn = device.childText("UDN")?.trim(),
      manufacturer = device.childText("manufacturer")?.trim(),
      model = device.childText("modelName")?.trim(),
      avTransportUrl = avTransport,
      renderingControlUrl = rendering,
      avTransportScpdUrl = avScpd,
    )
  }

  /**
   * The values AVTransport's `TransportPlaySpeed` allows, as the renderer writes them (`1`,
   * `3/2`, `2`). Only `1` when the description lists none.
   */
  fun parseSpeeds(scpd: String): List<String> {
    val doc = parse(scpd) ?: return listOf("1")
    val variable = doc.allElements().firstOrNull {
      localName(it.tagName) == "stateVariable" && it.childText("name")?.trim() == "TransportPlaySpeed"
    } ?: return listOf("1")
    val values = variable.child("allowedValueList")?.childElements()
      ?.filter { localName(it.tagName) == "allowedValue" }
      ?.mapNotNull { it.textContent?.trim()?.takeIf(String::isNotEmpty) }
      .orEmpty()
    return values.ifEmpty { listOf("1") }
  }

  /** A play speed as UPnP writes it, a fraction (`3/2`) or a number (`1.5`); null if neither. */
  fun speedValue(text: String): Float? {
    val parts = text.trim().split('/')
    return when (parts.size) {
      1 -> parts[0].toFloatOrNull()
      2 -> {
        val top = parts[0].toFloatOrNull() ?: return null
        val bottom = parts[1].toFloatOrNull()?.takeIf { it != 0f } ?: return null
        top / bottom
      }
      else -> null
    }
  }

  /** The renderer's own spelling of [speed], or null when it does not offer it. */
  fun speedArg(speed: Float, allowed: List<String>): String? =
    allowed.firstOrNull { text -> speedValue(text)?.let { kotlin.math.abs(it - speed) < 0.01f } == true }

  fun resolve(base: String, path: String): String? = try {
    URI(base).resolve(path.trim()).toString()
  } catch (e: IllegalArgumentException) {
    null
  }

  fun escape(text: String): String = buildString(text.length) {
    for (c in text) {
      when (c) {
        '&' -> append("&amp;")
        '<' -> append("&lt;")
        '>' -> append("&gt;")
        '"' -> append("&quot;")
        '\'' -> append("&apos;")
        else -> append(c)
      }
    }
  }

  /** A SOAP request body. Argument values are escaped here, so DIDL-Lite goes in as plain XML. */
  fun envelope(serviceType: String, action: String, args: List<Pair<String, String>>): String = buildString {
    append("<?xml version=\"1.0\" encoding=\"utf-8\"?>")
    append("<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" ")
    append("s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>")
    append("<u:$action xmlns:u=\"$serviceType\">")
    for ((name, value) in args) append("<$name>${escape(value)}</$name>")
    append("</u:$action></s:Body></s:Envelope>")
  }

  /** The out arguments of an action's response, by name. */
  fun parseResponse(xml: String, action: String): Map<String, String>? {
    val doc = parse(xml) ?: return null
    val response = doc.allElements().firstOrNull { localName(it.tagName) == "${action}Response" } ?: return null
    return response.childElements().associate { localName(it.tagName) to it.textContent.orEmpty() }
  }

  /** The UPnP error of a SOAP fault, such as `701 Transition not available`. */
  fun parseFault(xml: String): String? {
    val doc = parse(xml) ?: return null
    val elements = doc.allElements()
    val code = elements.firstOrNull { localName(it.tagName) == "errorCode" }?.textContent?.trim()
    val text = elements.firstOrNull { localName(it.tagName) == "errorDescription" }?.textContent?.trim()
    return listOfNotNull(code, text).joinToString(" ").ifEmpty { null }
  }

  fun call(controlUrl: String, serviceType: String, action: String, args: List<Pair<String, String>>): Map<String, String> {
    val response = MiniHttp.request(
      "POST",
      controlUrl,
      mapOf(
        "Content-Type" to "text/xml; charset=\"utf-8\"",
        "SOAPACTION" to "\"$serviceType#$action\"",
      ),
      envelope(serviceType, action, args).toByteArray(Charsets.UTF_8),
    )
    val text = response.text()
    if (response.status != 200) throw CastException("$action failed: ${parseFault(text) ?: "HTTP ${response.status}"}")
    return parseResponse(text, action) ?: emptyMap()
  }

  /** What renderers show while playing, and the type they check before fetching. */
  fun didl(media: CastMedia): String = buildString {
    append("<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" ")
    append("xmlns:dc=\"http://purl.org/dc/elements/1.1/\" ")
    append("xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">")
    append("<item id=\"1\" parentID=\"0\" restricted=\"1\">")
    append("<dc:title>${escape(media.title)}</dc:title>")
    media.artist?.let {
      append("<dc:creator>${escape(it)}</dc:creator>")
      append("<upnp:artist>${escape(it)}</upnp:artist>")
    }
    media.album?.let { append("<upnp:album>${escape(it)}</upnp:album>") }
    media.coverUrl?.let { append("<upnp:albumArtURI>${escape(it)}</upnp:albumArtURI>") }
    append("<upnp:class>object.item.audioItem.musicTrack</upnp:class>")
    append("<res protocolInfo=\"http-get:*:${media.mimeType}:*\"")
    if (media.durationMs > 0) append(" duration=\"${formatTime(media.durationMs)}.000\"")
    append(">${escape(media.url)}</res>")
    append("</item></DIDL-Lite>")
  }

  /** UPnP's H:MM:SS. */
  fun formatTime(ms: Long): String {
    val seconds = (ms.coerceAtLeast(0L) / 1000)
    return String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, (seconds / 60) % 60, seconds % 60)
  }

  /** H:MM:SS with optional fraction; null for NOT_IMPLEMENTED and the like. */
  fun parseTime(text: String?): Long? {
    val parts = text?.trim()?.split(':') ?: return null
    if (parts.size != 3) return null
    val h = parts[0].toLongOrNull() ?: return null
    val m = parts[1].toLongOrNull() ?: return null
    val s = parts[2].toDoubleOrNull() ?: return null
    return (h * 3600 + m * 60) * 1000 + (s * 1000).toLong()
  }

  fun playState(transportState: String?): PlayState = when (transportState) {
    "PLAYING" -> PlayState.PLAYING
    "PAUSED_PLAYBACK", "PAUSED_RECORDING" -> PlayState.PAUSED
    "TRANSITIONING" -> PlayState.BUFFERING
    else -> PlayState.IDLE
  }

  private fun parse(xml: String): Document? = try {
    val factory = DocumentBuilderFactory.newInstance()
    // Descriptions come from any device on the network: no DTDs, no entities.
    runCatching { factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
    factory.isExpandEntityReferences = false
    factory.isNamespaceAware = false
    factory.newDocumentBuilder().parse(InputSource(StringReader(xml.trim())))
  } catch (e: Exception) {
    null
  }

  private fun localName(tag: String) = tag.substringAfter(':')

  private fun Document.allElements(): List<Element> {
    val list = getElementsByTagName("*")
    return List(list.length) { list.item(it) as Element }
  }

  private fun Element.childElements(): List<Element> {
    val nodes = childNodes
    return (0 until nodes.length).mapNotNull { nodes.item(it) as? Element }
  }

  private fun Element.child(name: String): Element? = childElements().firstOrNull { localName(it.tagName) == name }

  private fun Element.childText(name: String): String? = child(name)?.textContent
}

/** AVTransport and RenderingControl of one renderer. */
class UpnpRenderer(private val device: CastDevice) : Renderer {
  private val transport = device.avTransportUrl ?: throw CastException(NativeText.current().t("{name} cannot play media", "name" to device.name))
  private val ends = EndWatch()
  private var media: CastMedia? = null

  // Most renderers list only 1; some take 1/2, 3/2 or 2 as Play's Speed.
  @Volatile
  private var speeds: List<String> = device.avTransportScpdUrl
    ?.let { url -> runCatching { Upnp.parseSpeeds(MiniHttp.request("GET", url).text()) }.getOrNull() }
    ?: listOf("1")
  private var speed = "1"

  private fun av(action: String, vararg args: Pair<String, String>) =
    Upnp.call(transport, Upnp.AV_TRANSPORT, action, listOf("InstanceID" to "0") + args)

  override fun canPlayAt(speed: Float): Boolean = Upnp.speedArg(speed, speeds) != null

  override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) {
    this.media = media
    ends.reset()
    this.speed = Upnp.speedArg(speed, speeds) ?: "1"
    av("SetAVTransportURI", "CurrentURI" to media.url, "CurrentURIMetaData" to Upnp.didl(media))
    play()
    if (startMs > 1_000) seekWhenReady(startMs)
    if (!autoplay) pause()
  }

  // Many renderers refuse Seek until the new track has started; retry for a few seconds.
  private fun seekWhenReady(positionMs: Long) {
    repeat(10) {
      try {
        seek(positionMs)
        return
      } catch (e: CastException) {
        Thread.sleep(400)
      }
    }
  }

  override fun play() {
    try {
      av("Play", "Speed" to speed)
    } catch (e: CastException) {
      // A renderer that listed the speed but refuses it still plays at 1x, and says so from now.
      if (speed == "1") throw e
      speeds = speeds - speed
      speed = "1"
      av("Play", "Speed" to speed)
    }
  }

  override fun pause() {
    ends.reset()
    av("Pause")
  }

  override fun seek(positionMs: Long) {
    av("Seek", "Unit" to "REL_TIME", "Target" to Upnp.formatTime(positionMs))
  }

  // UPnP sets the speed with Play; a playing renderer takes Play again with the new one.
  override fun setSpeed(speed: Float) {
    val arg = Upnp.speedArg(speed, speeds) ?: "1"
    if (arg == this.speed) return
    this.speed = arg
    if (ends.isPlaying) play()
  }

  override fun setVolume(level: Float) {
    val url = device.renderingControlUrl ?: return
    Upnp.call(
      url,
      Upnp.RENDERING_CONTROL,
      "SetVolume",
      listOf("InstanceID" to "0", "Channel" to "Master", "DesiredVolume" to (level.coerceIn(0f, 1f) * 100).toInt().toString()),
    )
  }

  override fun status(): RendererStatus {
    val info = av("GetTransportInfo")
    val position = av("GetPositionInfo")
    val volume = device.renderingControlUrl?.let { url ->
      runCatching {
        Upnp.call(url, Upnp.RENDERING_CONTROL, "GetVolume", listOf("InstanceID" to "0", "Channel" to "Master"))["CurrentVolume"]
          ?.toFloatOrNull()?.div(100f)
      }.getOrNull()
    }
    val state = ends.map(Upnp.playState(info["CurrentTransportState"]))
    return RendererStatus(
      state = state,
      positionMs = Upnp.parseTime(position["RelTime"]) ?: 0L,
      durationMs = Upnp.parseTime(position["TrackDuration"])?.takeIf { it > 0 } ?: (media?.durationMs ?: 0L),
      volume = volume,
    )
  }

  override fun close() {
    ends.reset()
    runCatching { av("Stop") }
  }
}

package app.lelap.library

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.Charset

/**
 * What [IdTags] reads. [ids]: ISBN and ASIN tags by name. For telling songs from books (M77): the
 * ISRC, a narrator tag and the MP4 media kind.
 */
data class FileTags(
  val ids: Map<String, String> = emptyMap(),
  val isrc: String? = null,
  val narrator: String? = null,
  /** MP4 `stik`: `music`, `audiobook`, `podcast` or `other`. */
  val mediaKind: String? = null,
  /** A Vorbis `GENRE` comment, from FLAC, Ogg Vorbis and Opus files, which Android may not give. */
  val genre: String? = null,
  /** The series and its number as `Dune #1` (M109), as Audiobookshelf writes them. */
  val series: String? = null,
)

/**
 * Tags Android's metadata reader doesn't give. ISBN and ASIN: ID3 `TXXX` frames, MP4 `----` items
 * and FLAC comments whose name holds “isbn” or ends in “asin”, raw by tag name; the app checks and
 * normalises them (`idsFromTags` in the SDK). The ISRC comes from ID3 `TSRC`, the MP4
 * `----:com.apple.iTunes:ISRC` item or a Vorbis `ISRC` comment; the media kind from MP4 `stik`.
 * Vorbis comments come from FLAC, Ogg Vorbis and Opus files; Audible's `CDEK` MP4 item is the ASIN.
 * The series (M109) comes from `SERIES` and `SERIES-PART` in any of them, or the movement name and
 * number (ID3 `MVNM` and `MVIN`, MP4 `©mvn` and `©mvi`).
 */
object IdTags {
  private const val MAX_FRAME_BYTES = 4 shl 10
  private const val MAX_BOX_BYTES = 8 shl 20
  private const val MAX_TAGS = 16
  private const val MAX_FLAC_BLOCKS = 64
  private const val MAX_COMMENTS = 256
  private const val MAX_OGG_PAGES = 4096

  /** ISBN and ASIN tags by name. */
  fun parse(name: String, read: (offset: Long, length: Int) -> ByteArray, size: Long): Map<String, String> =
    parseAll(name, read, size).ids

  fun parse(name: String, bytes: ByteArray): Map<String, String> = parseAll(name, bytes).ids

  fun parseAll(name: String, read: (offset: Long, length: Int) -> ByteArray, size: Long): FileTags = try {
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> id3(read, size)
      "m4a", "m4b", "mp4", "aac" -> mp4(read, size)
      "flac" -> flac(read, size)
      "ogg", "oga", "opus" -> ogg(read, size)
      else -> FileTags()
    }
  } catch (e: RuntimeException) {
    // A truncated or odd file has no such tags rather than failing a scan.
    FileTags()
  }

  fun parseAll(name: String, bytes: ByteArray): FileTags = parseAll(
    name,
    { offset, length -> bytes.copyOfRange(offset.toInt(), minOf(bytes.size.toLong(), offset + length).toInt()) },
    bytes.size.toLong(),
  )

  internal fun wanted(tag: String): Boolean {
    val key = tag.lowercase().filter { it.isLetterOrDigit() }
    return key.contains("isbn") || key.endsWith("asin")
  }

  internal fun isIsrc(tag: String) = tag.lowercase().filter { it.isLetter() } == "isrc"

  internal fun isNarrator(tag: String) =
    tag.lowercase().filter { it.isLetter() } in setOf("narrator", "narratedby", "reader")

  /** A series name: `SERIES`, or the movement name tagging apps use for it (`MVNM`, `©mvn`). */
  internal fun isSeries(tag: String) =
    tag.lowercase().filter { it.isLetter() } in setOf("series", "seriesname", "movementname", "mvnm")

  /** A number in the series: `SERIES-PART`, or the movement number (`MVIN`, `©mvi`). */
  internal fun isSeriesPart(tag: String) =
    tag.lowercase().filter { it.isLetter() } in
      setOf("seriespart", "seriesposition", "seriesindex", "seriessequence", "movement", "mvin")

  /** `Dune #1` from a name and a number such as `1` or `1/6`; the name alone without a number. */
  internal fun seriesText(name: String?, part: String?): String? {
    val clean = name?.replace("#", "")?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    // A decimal comma (“1,5”) is a decimal point here, as commas part series in the text.
    val number = part?.substringBefore('/')?.replace("#", "")?.replace(',', '.')?.trim()
      ?.takeIf { it.isNotEmpty() }
    return if (number != null) "$clean #$number" else clean
  }

  /** MP4 `stik` values as Apple uses them; 2 is an audiobook. */
  internal fun mediaKind(stik: Int): String = when (stik) {
    0, 1 -> "music"
    2 -> "audiobook"
    21 -> "podcast"
    else -> "other"
  }

  /** Collects tags by name, whichever container they come from. */
  private class Found {
    val ids = linkedMapOf<String, String>()
    var isrc: String? = null
    var narrator: String? = null
    var mediaKind: String? = null
    var genre: String? = null
    var series: String? = null
    var seriesPart: String? = null

    fun add(name: String, value: String) {
      if (value.isBlank()) return
      if (wanted(name) && ids.size < MAX_TAGS) ids[name] = value
      if (isIsrc(name)) isrc = isrc ?: value
      if (isNarrator(name)) narrator = narrator ?: value
      if (isSeries(name)) series = series ?: value
      if (isSeriesPart(name)) seriesPart = seriesPart ?: value
    }

    fun tags() = FileTags(ids, isrc, narrator, mediaKind, genre, seriesText(series, seriesPart))
  }

  private fun exactly(read: (Long, Int) -> ByteArray, size: Long, offset: Long, length: Int): ByteArray {
    require(offset >= 0 && length >= 0 && offset + length <= size)
    return read(offset, length).also { require(it.size == length) }
  }

  private val ID3_FRAMES = setOf("TXXX", "TXX", "TSRC", "TRC", "MVNM", "MVIN")

  private fun id3(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    val found = Found()
    // v2.2 names the same frames with three letters.
    Id3Frames.walk(read, size, { id, frameSize -> id in ID3_FRAMES && frameSize in 2..MAX_FRAME_BYTES }) { frame ->
      when (frame.id) {
        "TXXX", "TXX" -> txxx(frame.body)?.let { (description, value) -> found.add(description, value) }
        "TSRC", "TRC" -> textFrame(frame.body)?.let { found.isrc = it }
        "MVNM", "MVIN" -> textFrame(frame.body)?.let { found.add(frame.id, it) }
      }
      found.ids.size < MAX_TAGS
    }
    return found.tags()
  }

  private fun charsetOf(encoding: Int): Charset = when (encoding) {
    1 -> Charsets.UTF_16
    2 -> Charsets.UTF_16BE
    3 -> Charsets.UTF_8
    else -> Charsets.ISO_8859_1
  }

  /** A text frame such as `TSRC`: encoding, then the text. */
  internal fun textFrame(body: ByteArray): String? =
    String(body, 1, body.size - 1, charsetOf(body[0].toInt())).trimEnd('\u0000').trim().takeIf { it.isNotEmpty() }

  /** A `TXXX` body: encoding, description, terminator, value. */
  internal fun txxx(body: ByteArray): Pair<String, String>? {
    val encoding = body[0].toInt()
    val charset = charsetOf(encoding)
    val wide = encoding == 1 || encoding == 2
    var split = 1
    while (true) {
      if (split + (if (wide) 1 else 0) >= body.size) return null
      if (!wide && body[split] == 0.toByte()) break
      if (wide && body[split] == 0.toByte() && body[split + 1] == 0.toByte()) break
      split += if (wide) 2 else 1
    }
    val description = String(body, 1, split - 1, charset).trim()
    val valueStart = split + if (wide) 2 else 1
    // UTF-16 values carry their own byte order mark; the description's doesn't apply.
    val value = String(body, valueStart, body.size - valueStart, charset).trimEnd('\u0000').trim()
    return description to value
  }

  private class Box(val type: String, val bodyStart: Long, val end: Long)

  private fun mp4(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    fun boxes(start: Long, end: Long): List<Box> {
      val result = mutableListOf<Box>()
      var pos = start
      while (pos + 8 <= end) {
        val header = ByteBuffer.wrap(exactly(read, size, pos, 8))
        var length = header.int.toLong() and 0xffffffffL
        val type = String(header.array(), 4, 4, Charsets.ISO_8859_1)
        var bodyStart = pos + 8
        if (length == 1L) {
          length = ByteBuffer.wrap(exactly(read, size, pos + 8, 8)).long
          bodyStart = pos + 16
        } else if (length == 0L) {
          length = end - pos
        }
        if (length < bodyStart - pos || pos + length > end) break
        result += Box(type, bodyStart, pos + length)
        pos += length
      }
      return result
    }
    fun child(parent: Box?, type: String, skip: Long = 0): Box? =
      parent?.let { p -> boxes(p.bodyStart + skip, p.end).firstOrNull { it.type == type } }

    val moov = boxes(0, size).firstOrNull { it.type == "moov" } ?: return FileTags()
    val meta = child(child(moov, "udta"), "meta") ?: return FileTags()
    // ISO `meta` is a full box with 4 bytes of version and flags; QuickTime's is not.
    val fullBox = meta.end - meta.bodyStart >= 12 &&
      String(exactly(read, size, meta.bodyStart + 4, 4), Charsets.ISO_8859_1) != "hdlr"
    val ilst = child(meta, "ilst", if (fullBox) 4 else 0) ?: return FileTags()
    val found = Found()
    for (item in boxes(ilst.bodyStart, ilst.end)) {
      if (item.end - item.bodyStart > MAX_BOX_BYTES) continue
      when (item.type) {
        "stik" -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          // 8 bytes of type and locale, then the value: one byte, sometimes more, big-endian.
          val length = (data.end - data.bodyStart - 8).toInt()
          if (length !in 1..4) continue
          val bytes = exactly(read, size, data.bodyStart + 8, length)
          found.mediaKind = mediaKind(bytes.fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 0xff) })
        }
        // Audible's m4b files keep the ASIN here.
        "CDEK" -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          text(read, size, data, 8)?.let { found.add("asin", it) }
        }
        MOVEMENT_NAME_ATOM -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          text(read, size, data, 8)?.let { found.add("mvnm", it) }
        }
        // A 16-bit integer, as iTunes writes it.
        MOVEMENT_NUMBER_ATOM -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          val length = (data.end - data.bodyStart - 8).toInt()
          if (length !in 1..4) continue
          val bytes = exactly(read, size, data.bodyStart + 8, length)
          val number = bytes.fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 0xff) }
          if (number > 0) found.add("mvin", number.toString())
        }
        NARRATOR_ATOM -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          text(read, size, data, 8)?.let { found.add("narrator", it) }
        }
        "----" -> {
          val parts = boxes(item.bodyStart, item.end)
          val name = parts.firstOrNull { it.type == "name" }?.let { text(read, size, it, 4) } ?: continue
          if (!wanted(name) && !isIsrc(name) && !isNarrator(name) && !isSeries(name) && !isSeriesPart(name)) {
            continue
          }
          val value = parts.firstOrNull { it.type == "data" }?.let { text(read, size, it, 8) } ?: continue
          found.add(name, value)
        }
      }
    }
    return found.tags()
  }

  /** Apple's narrator item, `©nrt`. */
  private const val NARRATOR_ATOM = "©nrt"

  /** Apple's movement name and number, which audiobook taggers use for the series. */
  private const val MOVEMENT_NAME_ATOM = "©mvn"
  private const val MOVEMENT_NUMBER_ATOM = "©mvi"

  /**
   * FLAC: `fLaC`, then metadata blocks of a one-byte type (top bit: the last block) and a 24-bit
   * length. The Vorbis comment block, type 4, is little-endian, with `KEY=value` comments.
   */
  private fun flac(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    if (size < 8 || String(exactly(read, size, 0, 4), Charsets.ISO_8859_1) != "fLaC") return FileTags()
    var pos = 4L
    repeat(MAX_FLAC_BLOCKS) {
      val header = exactly(read, size, pos, 4)
      val type = header[0].toInt() and 0x7f
      val length = ((header[1].toInt() and 0xff) shl 16) or ((header[2].toInt() and 0xff) shl 8) or
        (header[3].toInt() and 0xff)
      if (type == 4) return vorbisComments(exactly(read, size, pos + 4, length))
      if (header[0].toInt() and 0x80 != 0) return FileTags()
      pos += 4L + length
    }
    return FileTags()
  }

  /**
   * Ogg Vorbis and Opus: pages of `OggS`, a 27-byte header and a lacing table of segment lengths;
   * a segment shorter than 255 bytes ends a packet. The first stream's second packet holds the
   * comments, after `\u0003vorbis` or `OpusTags`, and may span pages.
   */
  private fun ogg(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    var pos = 0L
    var serial: Int? = null
    var packet = 0
    val comments = ByteArrayOutputStream()
    repeat(MAX_OGG_PAGES) {
      if (pos + 27 > size) return FileTags()
      val header = exactly(read, size, pos, 27)
      require(String(header, 0, 4, Charsets.ISO_8859_1) == "OggS")
      val pageSerial = ByteBuffer.wrap(header, 14, 4).order(ByteOrder.LITTLE_ENDIAN).int
      val lacing = exactly(read, size, pos + 27, header[26].toInt() and 0xff)
      val dataStart = pos + 27 + lacing.size
      val dataLength = lacing.sumOf { it.toInt() and 0xff }
      if (serial == null) serial = pageSerial
      if (pageSerial == serial) {
        // The part of this page that belongs to the second packet, read at once.
        var offset = 0
        var from = -1
        var to = -1
        for (lace in lacing) {
          val n = lace.toInt() and 0xff
          if (packet == 1 && from < 0) from = offset
          offset += n
          if (packet == 1) to = offset
          if (n < 255 && packet++ == 1) break
        }
        if (from >= 0) {
          require(comments.size() + (to - from) <= MAX_BOX_BYTES)
          comments.write(exactly(read, size, dataStart + from, to - from))
        }
        if (packet > 1) return commentPacket(comments.toByteArray())
      }
      pos = dataStart + dataLength
    }
    return FileTags()
  }

  private fun commentPacket(packet: ByteArray): FileTags {
    val head = String(packet, 0, minOf(8, packet.size), Charsets.ISO_8859_1)
    return when {
      head.startsWith("\u0003vorbis") -> vorbisComments(packet.copyOfRange(7, packet.size))
      head == "OpusTags" -> vorbisComments(packet.copyOfRange(8, packet.size))
      else -> FileTags()
    }
  }

  internal fun vorbisComments(body: ByteArray): FileTags {
    val buffer = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN)
    val vendor = buffer.int
    require(vendor in 0..buffer.remaining())
    buffer.position(buffer.position() + vendor)
    val count = buffer.int
    val found = Found()
    for (i in 0 until minOf(count, MAX_COMMENTS)) {
      val length = buffer.int
      require(length in 0..buffer.remaining())
      val comment = String(body, buffer.position(), length, Charsets.UTF_8)
      buffer.position(buffer.position() + length)
      val key = comment.substringBefore('=', "")
      val value = comment.substringAfter('=').trim()
      if (key.isNotEmpty()) found.add(key, value)
      if (key.equals("genre", ignoreCase = true) && value.isNotEmpty()) found.genre = found.genre ?: value
    }
    return found.tags()
  }

  private fun text(read: (Long, Int) -> ByteArray, size: Long, box: Box, skip: Int): String? {
    val length = (box.end - box.bodyStart - skip).toInt()
    if (length < 0 || length > MAX_FRAME_BYTES) return null
    return String(exactly(read, size, box.bodyStart + skip, length), Charsets.UTF_8).trimEnd('\u0000').trim()
  }
}

package app.lelap.library

import java.nio.ByteBuffer

/** Chapters from an MP4/M4B: the Nero `chpl` list, else the QuickTime chapter text track. */
object Mp4Chapters {
  private class Box(val type: String, val start: Long, val bodyStart: Long, val end: Long)

  fun parse(read: (offset: Long, length: Int) -> ByteArray, size: Long): List<Chapter> = try {
    Reader(read, size).chapters()
  } catch (e: RuntimeException) {
    // Truncated or unexpected files have no chapters rather than failing a scan.
    emptyList()
  }

  private class Reader(private val read: (Long, Int) -> ByteArray, private val size: Long) {
    fun bytes(offset: Long, length: Int): ByteBuffer {
      require(length >= 0 && offset + length <= size)
      val data = read(offset, length)
      require(data.size == length)
      return ByteBuffer.wrap(data)
    }

    fun boxes(start: Long, end: Long): List<Box> {
      val result = mutableListOf<Box>()
      var pos = start
      while (pos + 8 <= end) {
        val header = bytes(pos, 8)
        var length = header.int.toLong() and 0xffffffffL
        val type = String(header.array(), 4, 4, Charsets.ISO_8859_1)
        var bodyStart = pos + 8
        if (length == 1L) {
          length = bytes(pos + 8, 8).long
          bodyStart = pos + 16
        } else if (length == 0L) {
          length = end - pos
        }
        if (length < bodyStart - pos || pos + length > end) break
        result += Box(type, pos, bodyStart, pos + length)
        pos += length
      }
      return result
    }

    fun child(parent: Box?, type: String): Box? =
      parent?.let { p -> boxes(p.bodyStart, p.end).firstOrNull { it.type == type } }

    fun body(box: Box): ByteBuffer = bytes(box.bodyStart, (box.end - box.bodyStart).toInt())

    fun chapters(): List<Chapter> {
      val moov = boxes(0, size).firstOrNull { it.type == "moov" } ?: return emptyList()
      val nero = child(child(moov, "udta"), "chpl")?.let { nero(body(it)) }.orEmpty()
      return nero.ifEmpty { quickTime(moov) }
    }

    fun nero(b: ByteBuffer): List<Chapter> {
      val version = b.get().toInt()
      b.position(4)
      if (version != 0) b.int
      val count = b.get().toInt() and 0xff
      return List(count) {
        val start = b.long
        val text = ByteArray(b.get().toInt() and 0xff).also { b.get(it) }
        // chpl times are in units of 100 ns.
        Chapter(String(text, Charsets.UTF_8), start / 10_000)
      }
    }

    fun trackId(trak: Box): Int? = child(trak, "tkhd")?.let {
      val b = body(it)
      val version = b.get().toInt()
      b.position(if (version == 1) 20 else 12)
      b.int
    }

    fun quickTime(moov: Box): List<Chapter> {
      val tracks = boxes(moov.bodyStart, moov.end).filter { it.type == "trak" }
      val chapterIds = tracks.mapNotNull { child(child(it, "tref"), "chap") }.flatMap { box ->
        val b = body(box)
        List(b.remaining() / 4) { b.int }
      }
      val text = tracks.firstOrNull { trackId(it) in chapterIds } ?: return emptyList()
      val mdia = child(text, "mdia")
      val stbl = child(child(mdia, "minf"), "stbl") ?: return emptyList()
      val timescale = child(mdia, "mdhd")?.let {
        val b = body(it)
        val version = b.get().toInt()
        b.position(if (version == 1) 20 else 12)
        b.int.toLong()
      } ?: return emptyList()
      if (timescale <= 0) return emptyList()

      val starts = mutableListOf<Long>()
      child(stbl, "stts")?.let {
        val b = body(it).position(4) as ByteBuffer
        var time = 0L
        repeat(b.int) {
          val count = b.int
          val delta = b.int.toLong() and 0xffffffffL
          repeat(count) { starts += time; time += delta }
        }
      }
      val sizes = child(stbl, "stsz")?.let {
        val b = body(it).position(4) as ByteBuffer
        val fixed = b.int
        val count = b.int
        List(count) { if (fixed != 0) fixed else b.int }
      }.orEmpty()
      val chunkOffsets = child(stbl, "stco")?.let {
        val b = body(it).position(4) as ByteBuffer
        List(b.int) { b.int.toLong() and 0xffffffffL }
      } ?: child(stbl, "co64")?.let {
        val b = body(it).position(4) as ByteBuffer
        List(b.int) { b.long }
      }.orEmpty()
      val runs = child(stbl, "stsc")?.let {
        val b = body(it).position(4) as ByteBuffer
        List(b.int) { Triple(b.int, b.int, b.int) }
      }.orEmpty()

      val offsets = mutableListOf<Long>()
      for ((chunkIndex, chunkOffset) in chunkOffsets.withIndex()) {
        val chunk = chunkIndex + 1
        val perChunk = runs.lastOrNull { it.first <= chunk }?.second ?: 1
        var offset = chunkOffset
        repeat(perChunk) {
          val sample = offsets.size
          if (sample >= sizes.size) return@repeat
          offsets += offset
          offset += sizes[sample]
        }
      }

      return offsets.indices.mapNotNull { i ->
        val start = starts.getOrNull(i) ?: return@mapNotNull null
        val sample = bytes(offsets[i], sizes[i])
        val length = sample.short.toInt() and 0xffff
        val title = ByteArray(minOf(length, sample.remaining())).also { sample.get(it) }
        Chapter(String(title, Charsets.UTF_8), start * 1000 / timescale)
      }
    }
  }
}

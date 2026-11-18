package app.lelap.cast

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException

/**
 * The Cast v2 wire message (`CastMessage` in Chromium's cast_channel.proto), encoded by hand:
 * 1 protocol_version (enum, 0 = CASTV2_1_0), 2 source_id, 3 destination_id, 4 namespace,
 * 5 payload_type (enum, 0 = STRING), 6 payload_utf8, 7 payload_binary. On the socket each
 * message follows its length as a 4-byte big-endian integer.
 */
data class CastMessage(
  val sourceId: String,
  val destinationId: String,
  val namespace: String,
  val payload: String,
  /** A binary payload (device authentication); [payload] is empty then. */
  val binary: ByteArray? = null,
) {
  companion object {
    /** Receivers refuse larger messages; so do we. */
    const val MAX_SIZE = 64 * 1024

    fun encode(message: CastMessage): ByteArray {
      val out = ByteArrayOutputStream()
      out.tag(1, 0)
      out.varint(0)
      out.string(2, message.sourceId)
      out.string(3, message.destinationId)
      out.string(4, message.namespace)
      val binary = message.binary
      if (binary == null) {
        out.tag(5, 0)
        out.varint(0)
        out.string(6, message.payload)
      } else {
        out.tag(5, 0)
        out.varint(1)
        out.bytes(7, binary)
      }
      return out.toByteArray()
    }

    /** Null for messages missing a field we need. */
    fun decode(bytes: ByteArray): CastMessage? {
      var source: String? = null
      var destination: String? = null
      var namespace: String? = null
      var payload: String? = null
      var binary: ByteArray? = null
      var i = 0
      fun varint(): Long {
        var result = 0L
        var shift = 0
        while (true) {
          if (i >= bytes.size || shift > 63) throw IOException("Truncated varint")
          val b = bytes[i++].toInt() and 0xff
          result = result or ((b and 0x7f).toLong() shl shift)
          if (b and 0x80 == 0) return result
          shift += 7
        }
      }
      try {
        while (i < bytes.size) {
          val key = varint()
          val field = (key ushr 3).toInt()
          when ((key and 7).toInt()) {
            0 -> varint()
            1 -> i += 8
            5 -> i += 4
            2 -> {
              val length = varint().toInt()
              if (length < 0 || i + length > bytes.size) return null
              if (field == 7) binary = bytes.copyOfRange(i, i + length)
              val text = String(bytes, i, length, Charsets.UTF_8)
              i += length
              when (field) {
                2 -> source = text
                3 -> destination = text
                4 -> namespace = text
                6 -> payload = text
              }
            }
            else -> return null
          }
        }
      } catch (e: IOException) {
        return null
      }
      if (payload == null && binary == null) return null
      return CastMessage(source ?: return null, destination ?: return null, namespace ?: return null, payload ?: "", binary)
    }

    fun frame(message: CastMessage): ByteArray {
      val body = encode(message)
      val size = body.size
      return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) + body
    }

    /** Reads frames until one decodes; throws at the end of the stream. */
    fun read(input: DataInputStream): CastMessage {
      while (true) {
        val size = input.readInt()
        if (size < 0 || size > MAX_SIZE) throw IOException("Bad Cast message size $size")
        val body = ByteArray(size)
        input.readFully(body)
        decode(body)?.let { return it }
      }
    }

    private fun ByteArrayOutputStream.varint(value: Long) {
      var v = value
      while (true) {
        if (v and 0x7fL.inv() == 0L) {
          write(v.toInt())
          return
        }
        write(((v and 0x7f) or 0x80).toInt())
        v = v ushr 7
      }
    }

    private fun ByteArrayOutputStream.tag(field: Int, wireType: Int) = varint(((field shl 3) or wireType).toLong())

    private fun ByteArrayOutputStream.string(field: Int, value: String) = bytes(field, value.toByteArray(Charsets.UTF_8))

    private fun ByteArrayOutputStream.bytes(field: Int, value: ByteArray) {
      tag(field, 2)
      varint(value.size.toLong())
      write(value)
    }
  }
}

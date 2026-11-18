package app.lelap.netfs

import java.util.concurrent.atomic.AtomicInteger

/** A server folder tree in memory: paths without a leading slash, folders end in `/`. */
class FakeServer(
  files: Map<String, ByteArray>,
  private val links: Map<String, String> = emptyMap(),
  private val denied: Set<String> = emptySet(),
) {
  private val files = files.toMutableMap()
  val opened = AtomicInteger()
  val closed = AtomicInteger()
  val listed = mutableListOf<String>()
  val reads = mutableListOf<Pair<Long, Int>>()

  private fun norm(path: String) = path.trim('/')

  // A path through a link, as the server would follow it.
  private fun resolve(path: String): String {
    val p = norm(path)
    val link = links.entries.firstOrNull { p == it.key || p.startsWith(it.key + "/") } ?: return p
    return link.value + p.removePrefix(link.key)
  }

  private fun folders(): Set<String> = (files.keys + links.keys).flatMap { path ->
    val parts = path.split('/')
    (1 until parts.size).map { parts.take(it).joinToString("/") }
  }.toSet()

  fun session(): NetSession {
    opened.incrementAndGet()
    return object : NetSession {
      var open = true
      override val alive get() = open

      override fun list(path: String): List<NetEntry> {
        val dir = resolve(path)
        listed += dir
        if (dir in denied) throw NetFailure(NetFailure.Kind.DENIED, "No access to $dir")
        if (dir.isNotEmpty() && dir !in folders()) throw NetFailure(NetFailure.Kind.NOT_FOUND, "No $dir")
        val prefix = if (dir.isEmpty()) "" else "$dir/"
        val names = (files.keys + links.keys + folders()).filter { it.startsWith(prefix) && it != dir }
          .map { it.removePrefix(prefix).substringBefore('/') }.toSet()
        return names.map { name ->
          val full = prefix + name
          when {
            full in links -> NetEntry(name, folder = false, size = 0, modifiedAt = 0, link = true)
            full in files -> NetEntry(name, folder = false, size = files.getValue(full).size.toLong(), modifiedAt = 1_000)
            else -> NetEntry(name, folder = true, size = 0, modifiedAt = 0)
          }
        }
      }

      override fun stat(path: String): NetEntry {
        val target = resolve(path)
        return when {
          target in files -> NetEntry(target.substringAfterLast('/'), false, files.getValue(target).size.toLong(), 1_000)
          target in folders() -> NetEntry(target.substringAfterLast('/'), true, 0, 0)
          else -> throw NetFailure(NetFailure.Kind.NOT_FOUND, "No $target")
        }
      }

      override fun open(path: String): NetFile {
        val bytes = files[resolve(path)] ?: throw NetFailure(NetFailure.Kind.NOT_FOUND, "No $path")
        return object : NetFile {
          override val length = bytes.size.toLong()
          override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int {
            reads += position to length
            if (position >= bytes.size) return -1
            // Like a real server: a short read now and then.
            val n = minOf(length, bytes.size - position.toInt(), 50_000)
            System.arraycopy(bytes, position.toInt(), buffer, offset, n)
            return n
          }
          override fun close() = Unit
        }
      }

      override fun close() {
        open = false
        closed.incrementAndGet()
      }
    }
  }
}

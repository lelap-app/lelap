package app.lelap.cast

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/** Picks the address to reach a receiver at from what mDNS resolved. */
object Addresses {
  /**
   * An IPv4 address first: every receiver has one, and it is what the receiver fetches the phone's
   * files back over. Then a routable IPv6 address, then a link-local one only with its scope, since
   * `fe80::…` without an interface can't be connected to.
   */
  fun pick(addresses: List<InetAddress?>): String? {
    val usable = addresses.filterNotNull().filterNot { it.isAnyLocalAddress || it.isLoopbackAddress }
    usable.firstOrNull { it is Inet4Address }?.let { return it.hostAddress }
    val v6 = usable.filterIsInstance<Inet6Address>()
    v6.firstOrNull { !it.isLinkLocalAddress }?.let { return it.hostAddress }
    return v6.firstOrNull { it.scopeId != 0 || it.scopedInterface != null }?.hostAddress
  }
}

/** Names of mDNS services as people see them. */
object ServiceNames {
  /** The key a service is kept under: the name it was found with, never the resolved one. */
  fun key(kind: String, serviceName: String): String = "$kind:$serviceName"

  /**
   * Google Cast puts the name people gave the speaker in `fn`. Otherwise the instance name, whose
   * DNS escapes (`\032` for a space, `\.`) older Android versions hand over as they are.
   */
  fun display(kind: String, serviceName: String, txt: Map<String, String?>): String {
    val given = if (kind == "cast") txt["fn"]?.trim() else null
    return given?.takeIf { it.isNotEmpty() } ?: unescape(serviceName)
  }

  fun unescape(name: String): String {
    val out = StringBuilder(name.length)
    var i = 0
    while (i < name.length) {
      val c = name[i]
      if (c == '\\' && i + 1 < name.length) {
        val digits = name.substring(i + 1, minOf(i + 4, name.length))
        if (digits.length == 3 && digits.all { it.isDigit() }) {
          out.append(digits.toInt().toChar())
          i += 4
          continue
        }
        out.append(name[i + 1])
        i += 2
        continue
      }
      out.append(c)
      i++
    }
    return out.toString()
  }
}

/**
 * Services waiting to be resolved, with at most [limit] resolving at once. Each start gets a token,
 * so a callback that arrives after a timeout or a stop can't end a later attempt.
 */
class ResolveQueue<T>(private val limit: Int) {
  data class Start<T>(val key: String, val item: T, val token: Int)

  private val waiting = LinkedHashMap<String, T>()
  private val active = HashMap<String, Int>()
  private var nextToken = 0

  val activeKeys: Set<String> get() = active.keys.toSet()

  val size: Int get() = waiting.size + active.size

  /** Queues a service; one already waiting or resolving is not queued twice. */
  fun offer(key: String, item: T): List<Start<T>> {
    if (key in active || key in waiting) return emptyList()
    waiting[key] = item
    return drain()
  }

  /** Ends an attempt. False when it had already ended (timed out, stopped, lost). */
  fun finish(key: String, token: Int): Pair<Boolean, List<Start<T>>> {
    if (active[key] != token) return false to emptyList()
    active.remove(key)
    return true to drain()
  }

  /** Drops a service that went away; returns whether it was resolving. */
  fun remove(key: String): Boolean {
    waiting.remove(key)
    return active.remove(key) != null
  }

  fun isCurrent(key: String, token: Int): Boolean = active[key] == token

  /** Empties the queue; returns the keys that were resolving, to cancel them. */
  fun clear(): Set<String> {
    val keys = active.keys.toSet()
    waiting.clear()
    active.clear()
    return keys
  }

  private fun drain(): List<Start<T>> {
    val started = mutableListOf<Start<T>>()
    while (active.size < limit && waiting.isNotEmpty()) {
      val key = waiting.keys.first()
      val item = waiting.remove(key)!!
      val token = ++nextToken
      active[key] = token
      started += Start(key, item, token)
    }
    return started
  }
}

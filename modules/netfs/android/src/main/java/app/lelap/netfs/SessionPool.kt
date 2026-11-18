package app.lelap.netfs

import java.io.Closeable
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Logged-in connections, shared by the player, downloads, the scan and casting. Opening one costs
 * a handshake and a login, and Media3 opens a file again on every seek, so a connection stays for
 * [idleMs] after its last user and is then closed. A broken one is closed at once.
 */
class SessionPool(
  private val connect: (NetAddress, NetLogin) -> NetSession,
  private val idleMs: Long = 60_000,
  private val clock: () -> Long = System::currentTimeMillis,
  /** Null in tests, which call [sweep] themselves. */
  sweepEveryMs: Long? = 20_000,
) {
  internal class Slot(val session: NetSession) {
    var users = 0
    var lastUsed = 0L
    var broken = false
  }

  /** One borrowed connection; [close] gives it back. */
  inner class Lease internal constructor(private val key: String, private val slot: Slot) : Closeable {
    val session: NetSession get() = slot.session
    private var returned = false

    /** The connection failed; nobody gets it again. */
    fun broken() = synchronized(this@SessionPool) { slot.broken = true }

    override fun close() {
      val closeNow = synchronized(this@SessionPool) {
        if (returned) return
        returned = true
        slot.users--
        slot.lastUsed = clock()
        if ((slot.broken || !slot.session.alive) && slot.users == 0) {
          if (slots[key] === slot) slots.remove(key)
          true
        } else {
          false
        }
      }
      if (closeNow) runCatching { slot.session.close() }
    }
  }

  private val slots = HashMap<String, Slot>()
  private val refusals = HashMap<String, Pair<Long, NetFailure>>()
  /** A handshake gate and how many callers hold or wait for it; it goes when none do. */
  private class Gate { var users = 0 }
  private val opening = HashMap<String, Gate>()
  private val sweeper: ScheduledExecutorService? = sweepEveryMs?.let { every ->
    Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-netfs-sweep").apply { isDaemon = true } }.also {
      it.scheduleWithFixedDelay({ runCatching { sweep() } }, every, every, TimeUnit.MILLISECONDS)
    }
  }

  private companion object {
    const val REFUSAL_MS = 5 * 60_000L
  }

  private fun keyOf(address: NetAddress, login: NetLogin) = address.server + "|" + login.fingerprint

  /** A connection for [address] with [login]; opens one when none is free to share. */
  fun lease(address: NetAddress, login: NetLogin): Lease {
    val key = keyOf(address, login)
    // One handshake per server at a time; other servers are not held up by a slow one.
    val gate = synchronized(this) { opening.getOrPut(key) { Gate() }.also { it.users++ } }
    try {
      return openThrough(gate, key, address, login)
    } finally {
      synchronized(this) {
        if (--gate.users == 0 && opening[key] === gate) opening.remove(key)
      }
    }
  }

  private fun openThrough(gate: Gate, key: String, address: NetAddress, login: NetLogin): Lease {
    synchronized(gate) {
      synchronized(this) {
        val slot = slots[key]
        if (slot != null && !slot.broken && slot.session.alive) {
          slot.users++
          return Lease(key, slot)
        }
      }
      // A refused login is not tried again for a while: each try counts against the account,
      // and servers block a phone that keeps failing.
      synchronized(this) {
        refusals[key]?.let { (at, failure) -> if (clock() - at < REFUSAL_MS) throw failure else refusals.remove(key) }
      }
      val session = try {
        connect(address, login)
      } catch (e: NetFailure) {
        if (e.kind == NetFailure.Kind.LOGIN) synchronized(this) { refusals[key] = clock() to e }
        throw e
      }
      val (lease, stale) = synchronized(this) {
        val stale = slots[key]
        val slot = Slot(session).apply { users = 1 }
        slots[key] = slot
        Lease(key, slot) to stale?.takeIf { it.users == 0 }
      }
      // Closed outside the lock: a logoff can take as long as the server's timeout.
      stale?.let { runCatching { it.session.close() } }
      return lease
    }
  }

  /** Runs [block] on a leased connection; a connection that failed is not used again. */
  fun <T> use(address: NetAddress, login: NetLogin, block: (NetSession) -> T): T {
    val lease = lease(address, login)
    try {
      return block(lease.session)
    } catch (e: Exception) {
      if (breaksConnection(e)) lease.broken()
      throw e
    } finally {
      lease.close()
    }
  }

  /** Closes connections nobody used for [idleMs], and broken ones nobody holds. */
  fun sweep() {
    val now = clock()
    val closing = synchronized(this) {
      val idle = slots.filterValues { it.users == 0 && (it.broken || !it.session.alive || now - it.lastUsed >= idleMs) }
      idle.keys.forEach { slots.remove(it) }
      idle.values.toList()
    }
    closing.forEach { runCatching { it.session.close() } }
  }

  /** How many connections are open; for tests. */
  val open: Int get() = synchronized(this) { slots.size }

  /** How many handshake gates are kept; for tests. */
  internal val gates: Int get() = synchronized(this) { opening.size }

  fun closeAll() {
    val all = synchronized(this) { slots.values.toList().also { slots.clear() } }
    all.forEach { runCatching { it.session.close() } }
    sweeper?.shutdownNow()
  }
}

package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.Inet6Address
import java.net.InetAddress

class AddressesTest {
  private fun ip(text: String): InetAddress = InetAddress.getByName(text)

  @Test
  fun prefersIpv4WhereverItIsInTheList() {
    assertEquals("192.168.32.11", Addresses.pick(listOf(ip("2001:db8::5"), ip("fe80::1"), ip("192.168.32.11"))))
  }

  @Test
  fun takesARoutableIpv6WithoutIpv4() {
    assertEquals("2001:db8:0:0:0:0:0:5", Addresses.pick(listOf(ip("fe80::1"), ip("2001:db8::5"))))
  }

  @Test
  fun takesLinkLocalIpv6OnlyWithItsScope() {
    val bytes = ip("fe80::1").address
    assertNull(Addresses.pick(listOf(Inet6Address.getByAddress(null, bytes, 0))))
    val scoped = Addresses.pick(listOf(Inet6Address.getByAddress(null, bytes, 3)))
    assertEquals("fe80:0:0:0:0:0:0:1%3", scoped)
  }

  @Test
  fun nothingUsable() {
    assertNull(Addresses.pick(emptyList()))
    assertNull(Addresses.pick(listOf(null)))
    assertNull(Addresses.pick(listOf(ip("127.0.0.1"), ip("0.0.0.0"))))
  }
}

class ServiceNamesTest {
  @Test
  fun googleCastUsesTheGivenName() {
    val txt = mapOf("fn" to "Hallway speaker", "md" to "Google Nest Mini", "id" to "abc")
    assertEquals("Hallway speaker", ServiceNames.display("cast", "Google-Nest-Mini-abc", txt))
  }

  @Test
  fun fallsBackToTheUnescapedInstanceName() {
    assertEquals("SHIELD Android TV", ServiceNames.display("cast", "SHIELD\\032Android\\032TV", mapOf("fn" to " ")))
    assertEquals("Desk.receiver", ServiceNames.display("fcast", "Desk\\.receiver", mapOf("fn" to "ignored")))
  }

  @Test
  fun keyIsTheFoundName() {
    assertEquals("cast:SHIELD\\032Android\\032TV", ServiceNames.key("cast", "SHIELD\\032Android\\032TV"))
  }
}

class ResolveQueueTest {
  @Test
  fun startsUpToTheLimitThenOneForEachThatEnds() {
    val queue = ResolveQueue<String>(limit = 2)
    assertEquals(listOf("a"), queue.offer("a", "a").map { it.key })
    val b = queue.offer("b", "b").single()
    assertTrue(queue.offer("c", "c").isEmpty())
    val (ended, next) = queue.finish(b.key, b.token)
    assertTrue(ended)
    assertEquals(listOf("c"), next.map { it.key })
  }

  @Test
  fun aServiceFoundAgainIsNotQueuedTwice() {
    val queue = ResolveQueue<String>(limit = 1)
    queue.offer("a", "a")
    assertTrue(queue.offer("a", "a").isEmpty())
    queue.offer("b", "b")
    assertTrue(queue.offer("b", "b").isEmpty())
    assertEquals(2, queue.size)
  }

  @Test
  fun aLateCallbackCannotEndALaterAttempt() {
    val queue = ResolveQueue<String>(limit = 1)
    val first = queue.offer("a", "a").single()
    // Timed out: the attempt ends, and the service is found and resolved again.
    assertTrue(queue.finish(first.key, first.token).first)
    val second = queue.offer("a", "a").single()
    assertFalse(queue.finish(first.key, first.token).first)
    assertTrue(queue.isCurrent(second.key, second.token))
  }

  @Test
  fun aFailureFreesTheSlot() {
    // The old code stayed `resolving` for ever when resolveService threw or never answered.
    val queue = ResolveQueue<String>(limit = 1)
    val a = queue.offer("a", "a").single()
    assertTrue(queue.offer("b", "b").isEmpty())
    assertEquals(listOf("b"), queue.finish(a.key, a.token).second.map { it.key })
  }

  @Test
  fun clearAndRemove() {
    val queue = ResolveQueue<String>(limit = 1)
    val a = queue.offer("a", "a").single()
    queue.offer("b", "b")
    assertFalse(queue.remove("b"))
    assertEquals(setOf("a"), queue.clear())
    assertFalse(queue.isCurrent(a.key, a.token))
    assertEquals(0, queue.size)
  }
}

class DiscoveryLogTest {
  private var now = 1_000L
  private val logcat = mutableListOf<String>()
  private val log = DiscoveryLog(clock = { now++ }) { what, kind, code -> logcat += "$kind $what $code" }

  @Test
  fun groupsRepeatsAndDrains() {
    log.begin()
    log.record(DiscoveryLog.STARTED, "cast")
    log.record(DiscoveryLog.FOUND, "cast")
    log.record(DiscoveryLog.FOUND, "cast")
    log.record(DiscoveryLog.RESOLVE_FAILED, "fcast", 0)
    val events = log.take()
    assertEquals(listOf("started", "found", "resolve-failed"), events.map { it.what })
    assertEquals(2, events[1].count)
    assertEquals(0, events[2].code)
    assertTrue(log.take().isEmpty())
    assertEquals(4, logcat.size)
  }

  @Test(expected = IllegalArgumentException::class)
  fun refusesWordsOffTheList() {
    log.record("Hallway speaker", "cast")
  }

  @Test
  fun aSearchThatCouldNotStartIsTheProblem() {
    log.begin()
    log.record(DiscoveryLog.STARTED, "fcast")
    log.record(DiscoveryLog.START_FAILED, "cast", 0)
    val summary = log.summary()
    assertEquals("start-failed", summary["problem"])
    assertEquals(0, summary["code"])
  }

  @Test
  fun aSecondTryThatStartsClearsIt() {
    log.begin()
    log.record(DiscoveryLog.START_FAILED, "cast", DiscoveryLog.CODE_NO_ANSWER)
    log.record(DiscoveryLog.STARTED, "cast")
    assertNull(log.summary()["problem"])
  }

  @Test
  fun foundButNoneAddedSaysWhy() {
    log.begin()
    log.record(DiscoveryLog.STARTED, "cast")
    log.record(DiscoveryLog.FOUND, "cast")
    log.record(DiscoveryLog.FOUND, "cast")
    log.record(DiscoveryLog.NO_ADDRESS, "cast")
    val summary = log.summary()
    assertEquals("no-address", summary["problem"])
    assertEquals(2, summary["found"])
    log.record(DiscoveryLog.ADDED, "cast")
    assertNull(log.summary()["problem"])
    assertEquals(1, log.summary()["added"])
  }

  @Test
  fun aNewSearchStartsClean() {
    log.begin()
    log.record(DiscoveryLog.START_FAILED, "cast", DiscoveryLog.CODE_NO_ACCESS)
    log.end()
    assertEquals(false, log.summary()["searching"])
    log.begin()
    assertNull(log.summary()["problem"])
    assertEquals(true, log.summary()["searching"])
  }
}

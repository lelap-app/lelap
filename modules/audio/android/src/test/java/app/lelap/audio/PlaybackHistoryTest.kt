package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackHistoryTest {
  private fun entry(at: Long) = HistoryReport("b", PlaybackHistory.SKIP, PlaybackHistory.HEADPHONES, at, 0L, 30_000L)

  @Test fun keepsActionsForTheAppInOrder() {
    val json = PlaybackHistory.append(PlaybackHistory.append(null, entry(1)), entry(2))
    assertEquals(listOf(entry(1), entry(2)), PlaybackHistory.decode(json))
  }

  @Test fun keepsOnlyTheNewest() {
    var json: String? = null
    repeat(PlaybackHistory.LIMIT + 3) { json = PlaybackHistory.append(json, entry(it.toLong())) }
    val list = PlaybackHistory.decode(json)
    assertEquals(PlaybackHistory.LIMIT, list.size)
    assertEquals(3L, list.first().at)
  }

  @Test fun aBrokenBufferIsEmpty() {
    assertEquals(emptyList<HistoryReport>(), PlaybackHistory.decode("{nope"))
    assertEquals(emptyList<HistoryReport>(), PlaybackHistory.decode(null))
  }

  @Test fun namesWhereACommandCameFrom() {
    fun of(pkg: String, app: Boolean = false, notification: Boolean = false, car: Boolean = false) =
      PlaybackHistory.sourceOf(pkg, "app.lelap", app, notification, car)
    assertNull(of("app.lelap", app = true))
    assertEquals("notification", of("app.lelap", notification = true))
    assertEquals("widget", of("app.lelap"))
    assertEquals("notification", of("com.android.systemui"))
    assertEquals("other", of("android.media.session.MediaController"))
    assertEquals("headphones", of("com.android.bluetooth"))
    assertEquals("car", of("com.google.android.projection.gearhead"))
    assertEquals("car", of("anything", car = true))
    assertEquals("watch", of("com.google.android.wearable.app"))
    assertEquals("other", of("com.example.remote"))
  }
}

class BackOfferTest {
  private val minute = 60_000L
  private var now = 0L
  private val offer = BackOffer { now }

  @Test fun offersBackAfterALongJumpAwayFromTheApp() {
    assertTrue(offer.jumped("b", 60 * minute, 90 * minute, external = true))
    assertEquals(60 * minute, offer.offer?.fromMs)
  }

  @Test fun aShortJumpOrTheAppsOwnOffersNothing() {
    assertFalse(offer.jumped("b", 60 * minute, 60 * minute + 30_000L, external = true))
    assertNull(offer.offer)
    now += 40_000L
    assertFalse(offer.jumped("b", 0L, 90 * minute, external = false))
    assertNull(offer.offer)
  }

  @Test fun aRunOfSkipsCountsFromItsFirstPlace() {
    offer.jumped("b", 60 * minute, 60 * minute + 30_000L, external = true)
    now += 2_000L
    assertTrue(offer.jumped("b", 60 * minute + 30_000L, 61 * minute + 30_000L, external = true))
    assertEquals(60 * minute, offer.offer?.fromMs)
  }

  @Test fun theOfferRunsOutAfterThirtySeconds() {
    offer.jumped("b", 0L, 10 * minute, external = true)
    now += 29_000L
    assertFalse(offer.expire())
    now += 1_000L
    assertTrue(offer.expire())
    assertNull(offer.offer)
    // A later skip starts afresh.
    assertFalse(offer.jumped("b", 10 * minute, 10 * minute + 30_000L, external = true))
  }

  @Test fun theAppsOwnJumpTakesTheButtonAway() {
    offer.jumped("b", 0L, 10 * minute, external = true)
    assertTrue(offer.jumped("b", 10 * minute, 11 * minute, external = false))
    assertNull(offer.offer)
  }
}

package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SleepPlaceTest {
  private val minute = 60_000L
  private fun mark(atMin: Long, placeMin: Long, book: String = "b") = PlaceMark(book, atMin * minute, placeMin * minute)

  @Test fun keepsTheStopAndTheLastTouch() {
    val place = SleepPlace.at(stopped = mark(atMin = 30, placeMin = 130), lastInteraction = mark(atMin = 12, placeMin = 112))
    assertEquals(130 * minute, place.stoppedMs)
    assertEquals(30 * minute, place.stoppedAt)
    assertEquals(112 * minute, place.usedMs)
    assertEquals(12 * minute, place.usedAt)
  }

  @Test fun withoutATouchOnlyTheStopIsKept() {
    val place = SleepPlace.at(mark(30, 130), null)
    assertEquals(130 * minute, place.stoppedMs)
    assertNull(place.usedMs)
    assertNull(place.usedAt)
  }

  @Test fun aTouchInAnotherBookDoesNotCount() {
    assertNull(SleepPlace.at(mark(30, 130), mark(0, 10, book = "other")).usedMs)
  }

  @Test fun aTouchAfterTheStopOrFurtherOnDoesNotCount() {
    assertNull(SleepPlace.at(mark(30, 130), mark(atMin = 31, placeMin = 50)).usedMs)
    // Seeking past the stop place and back: that place is no earlier in the book.
    assertNull(SleepPlace.at(mark(30, 130), mark(atMin = 20, placeMin = 140)).usedMs)
  }

  @Test fun encodesAndDecodes() {
    val touched = SleepPlace.at(mark(30, 130), mark(0, 100))
    assertEquals(touched, SleepPlace.decode(touched.encode()))
    val untouched = SleepPlace.at(mark(30, 130), null)
    assertEquals(untouched, SleepPlace.decode(untouched.encode()))
    assertNull(SleepPlace.decode(null))
    assertNull(SleepPlace.decode("{}"))
  }
}

package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListStepsTest {
  private fun load(id: String, position: Long = 250, handsOver: Boolean = true) = BookLoad(
    BookPlaylist(id, "Title $id", null, null, listOf(BookFile("https://x/$id.mp3", "loc-$id", "Part", 1000)), emptyList(), 1f),
    startIndex = 0,
    startPositionMs = position,
    pausedAt = 99,
    handsOver = handsOver,
  )

  private fun ids(list: List<BookLoad>) = list.map { it.playlist.bookId }

  private val list = ListPlay("l1", "Road trip", at = "c", before = listOf(load("b"), load("a")), keepsFinished = false)

  @Test fun `previous is offered on the list's own item with something before it`() {
    assertTrue(ListSteps.offersPrevious(list, "c"))
    assertFalse(ListSteps.offersPrevious(list, "upnext"))
    assertFalse(ListSteps.offersPrevious(list.copy(before = emptyList()), "c"))
    assertFalse(ListSteps.offersPrevious(null, "c"))
  }

  @Test fun `previous plays the item before, and this one comes next again after Up Next`() {
    // Up Next "u", then the list's "d".
    val queue = listOf(load("u"), load("d"))
    val step = ListSteps.previous(list, queue, listNext = 1, current = load("c", position = 40_000))!!
    assertEquals("b", step.play.playlist.bookId)
    assertEquals(listOf("u", "c", "d"), ids(step.queue))
    assertEquals(1, step.listNext)
    assertEquals(40_000L, step.queue[1].startPositionMs)
    assertEquals("b", step.list.at)
    assertEquals(listOf("a"), ids(step.list.before))
  }

  @Test fun `previous at the list's end puts this item after Up Next`() {
    val step = ListSteps.previous(list, listOf(load("u")), listNext = -1, current = load("c"))!!
    assertEquals(listOf("u", "c"), ids(step.queue))
    assertEquals(1, step.listNext)
  }

  @Test fun `previous does nothing while Up Next plays between the list's items`() {
    assertNull(ListSteps.previous(list, emptyList(), -1, load("upnext")))
  }

  @Test fun `moving on keeps the list's item to go back to, not an Up Next one`() {
    val next = ListSteps.moved(list, load("c"), "d", nextInList = true)
    assertEquals("d", next.at)
    assertEquals(listOf("c", "b", "a"), ids(next.before))
    // To Up Next: nothing of the list plays until its next item.
    val toUpNext = ListSteps.moved(list, null, "u", nextInList = false)
    assertNull(toUpNext.at)
    assertEquals(listOf("b", "a"), ids(toUpNext.before))
    val fromUpNext = ListSteps.moved(toUpNext, load("u"), "d", nextInList = true)
    assertEquals("d", fromUpNext.at)
    assertEquals(listOf("b", "a"), ids(fromUpNext.before))
  }

  @Test fun `a list started in the car plays Up Next first, without the list's own items`() {
    val (queue, listNext) = ListSteps.startQueue(
      upNext = listOf(load("u", handsOver = false), load("d", handsOver = false), load("c")),
      pickedId = "c",
      after = listOf(load("d"), load("e")),
    )
    assertEquals(listOf("u", "d", "e"), ids(queue))
    assertEquals(1, listNext)
    assertTrue(queue.all { it.handsOver })
    assertEquals(-1, ListSteps.startQueue(emptyList(), "c", emptyList()).second)
  }

  @Test fun `the list survives being saved`() {
    assertEquals(list, ListPlay.decode(list.encode()))
    assertEquals(list.copy(at = null), ListPlay.decode(list.copy(at = null).encode()))
    assertNull(ListPlay.decode(""))
    assertNull(ListPlay.decode("not json"))
  }
}

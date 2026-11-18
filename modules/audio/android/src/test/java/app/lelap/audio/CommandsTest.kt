package app.lelap.audio

import androidx.media3.common.Player
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CommandsTest {
  @Test
  fun aRefusedCommandReachesJavaScriptWithItsReason() {
    assertNull(Commands.failure(SessionResult.RESULT_SUCCESS, null, "fallback"))
    assertEquals(
      "The player could not read this book",
      Commands.failure(SessionError.ERROR_BAD_VALUE, "The player could not read this book", "fallback"),
    )
    assertEquals("fallback", Commands.failure(SessionError.ERROR_UNKNOWN, " ", "fallback"))
    // No answer at all (the service went away) is a failure too.
    assertEquals("fallback", Commands.failure(null, null, "fallback"))
  }

  @Test
  fun controllersHearANewSkipInterval() {
    val heard = mutableListOf<String>()
    val listener = object : Player.Listener {
      override fun onSeekBackIncrementChanged(seekBackIncrementMs: Long) {
        heard += "back $seekBackIncrementMs"
      }

      override fun onSeekForwardIncrementChanged(seekForwardIncrementMs: Long) {
        heard += "forward $seekForwardIncrementMs"
      }
    }
    val increments = SkipIncrements()
    increments.add(listener)
    increments.add(listener)
    increments.announce(15_000)
    assertEquals(listOf("back 15000", "forward 15000"), heard)
    increments.remove(listener)
    increments.announce(45_000)
    assertEquals(2, heard.size)
  }
}

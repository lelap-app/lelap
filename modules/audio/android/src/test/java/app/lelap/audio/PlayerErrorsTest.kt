package app.lelap.audio

import androidx.media3.common.PlaybackException
import app.lelap.text.NativeCatalog
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerErrorsTest {
  private val en = NativeCatalog.ENGLISH
  private val ms = NativeCatalog("ms", mapOf("No answer from the server." to "Tiada jawapan daripada pelayan."))

  @Test fun namesTheKindOfFailureNotMedia3sCode() {
    assertEquals(
      "Tiada jawapan daripada pelayan.",
      PlayerErrors.text(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, "Source error", ms),
    )
    assertEquals(
      "This file can’t be read. It may be damaged, or in a format Lelap does not play.",
      PlayerErrors.text(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, "Source error", en),
    )
    assertEquals(
      "This phone can’t play this kind of audio.",
      PlayerErrors.text(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED, null, en),
    )
    assertEquals(
      "The file could not be played. Press play to try again.",
      PlayerErrors.text(PlaybackException.ERROR_CODE_UNSPECIFIED, "Unexpected runtime error", en),
    )
  }

  @Test fun castingKeepsItsOwnLine() {
    assertEquals("Sambungan ke Dapur terputus", PlayerErrors.text(PlaybackException.ERROR_CODE_REMOTE_ERROR, "Sambungan ke Dapur terputus", ms))
    assertEquals("Casting stopped", PlayerErrors.text(PlaybackException.ERROR_CODE_REMOTE_ERROR, null, en))
  }
}

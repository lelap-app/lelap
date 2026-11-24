package app.lelap.download

import app.lelap.text.ShownException
import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class ServerAddressesTest {
  private val home = "http://192.168.1.20:8096/Audio/1/stream"
  private val away = "https://media.example.org/Audio/1/stream"
  private val file = JobFile(home, "001.mp3", 10, also = away)

  @Test fun triesTheOwnAddressFirstThenTheOther() {
    assertEquals(listOf(home, away), ServerAddresses.order(file, preferAlso = false))
    assertEquals(listOf(away, home), ServerAddresses.order(file, preferAlso = true))
    assertEquals(listOf(home), ServerAddresses.order(JobFile(home, "001.mp3", 10), preferAlso = true))
    assertEquals(listOf(home), ServerAddresses.order(JobFile(home, "001.mp3", 10, also = home), false))
  }

  @Test fun takesTheOtherAddressWhenTheFirstIsSilent() = runBlocking {
    val asked = mutableListOf<String>()
    val used = ServerAddresses.firstAnswering(listOf(home, away)) {
      asked += it
      if (it == home) throw ConnectException("failed to connect")
    }
    assertEquals(away, used)
    assertEquals(listOf(home, away), asked)
  }

  @Test fun anAnswerIsNotSilence() = runBlocking {
    val refused = ShownException("The server answered HTTP 500.")
    val asked = mutableListOf<String>()
    try {
      ServerAddresses.firstAnswering(listOf(home, away)) {
        asked += it
        throw refused
      }
      fail("expected the server's answer")
    } catch (e: IOException) {
      assertSame(refused, e)
    }
    assertEquals(listOf(home), asked)
  }

  @Test fun bothSilentGivesTheFirstError() = runBlocking {
    val first = UnknownHostException("nas.local")
    try {
      ServerAddresses.firstAnswering(listOf(home, away)) {
        throw if (it == home) first else ConnectException("away")
      }
      fail("expected an error")
    } catch (e: IOException) {
      assertSame(first, e)
    }
  }

  @Test fun keepsTheOtherAddressThroughJson() {
    val job = DownloadJob(
      bookId = "b1",
      title = "T",
      files = listOf(file),
      cover = null,
      rules = Rules(wifiOnly = true, chargingOnly = false),
    )
    assertEquals(job, DownloadJob.decode(job.encode()))
    val json = """{"bookId":"b1","title":"T","files":[{"url":"$home","name":"001.mp3","size":5,"also":"$away"}],"cover":null,"rules":{"wifiOnly":true,"chargingOnly":false}}"""
    assertEquals(away, DownloadJob.decode(json)?.files?.single()?.also)
  }
}

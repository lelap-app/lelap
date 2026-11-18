package app.lelap.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DownloadJobTest {
  private val job = DownloadJob(
    bookId = "0193f7a2-1c2d-7e3f-8a4b-5c6d7e8f9a0b",
    title = "The Secret Garden",
    files = listOf(JobFile("https://a.example/1.mp3", "001.mp3", 1000), JobFile("https://a.example/2.mp3", "002.mp3", 0)),
    cover = JobFile("https://img.example/c.jpg", "cover.jpg", 0),
    rules = Rules(wifiOnly = true, chargingOnly = false),
  )

  @Test fun `round-trips through JSON`() {
    assertEquals(job, DownloadJob.decode(job.encode()))
    val withLogin = job.copy(headers = mapOf("Authorization" to "Basic bWU6cHc="))
    assertEquals(withLogin, DownloadJob.decode(withLogin.encode()))
    assertEquals(job.copy(cover = null), DownloadJob.decode(job.copy(cover = null).encode()))
    val onCard = job.copy(location = "content://com.android.externalstorage.documents/tree/1A2B-3C4D%3A", revision = "r1")
    assertEquals(onCard, DownloadJob.decode(onCard.encode()))
    val onLan = job.copy(localNetwork = true)
    assertEquals(onLan, DownloadJob.decode(onLan.encode()))
  }

  @Test fun `a job from before chosen folders is in private storage`() {
    val json = """{"bookId":"b1","title":"T","files":[{"url":"https://x/1.mp3","name":"001.mp3","size":5}],"cover":null,"rules":{"wifiOnly":false,"chargingOnly":true}}"""
    assertNull(DownloadJob.decode(json)?.location)
    // Jobs from before Android 17's local network check are treated as on the internet.
    assertFalse(DownloadJob.decode(json)!!.localNetwork)
  }

  @Test fun `reads the plan JavaScript sends`() {
    val json = """{"bookId":"b1","title":"T","bytesTotal":5,"files":[{"url":"https://x/1.mp3","name":"001.mp3","size":5}],"cover":null,"rules":{"wifiOnly":false,"chargingOnly":true}}"""
    val decoded = DownloadJob.decode(json)
    assertEquals(listOf(JobFile("https://x/1.mp3", "001.mp3", 5)), decoded?.files)
    assertEquals(Rules(wifiOnly = false, chargingOnly = true), decoded?.rules)
  }

  @Test fun `refuses names that leave the book's folder`() {
    listOf("../001.mp3", "a/b.mp3", ".hidden", "", "001.mp3.part").forEach {
      assertFalse(it, DownloadJob.isSafeName(it))
    }
    assertTrue(DownloadJob.isSafeName("001.mp3"))
    val escaping = job.copy(files = listOf(JobFile("https://x", "../../evil", 0)))
    assertNull(DownloadJob.decode(escaping.encode()))
    assertNull(DownloadJob.decode(job.copy(bookId = "..").encode()))
  }

  @Test fun `drops the login once done, unless the book was started again`() {
    val dir = java.nio.file.Files.createTempDirectory("job").toFile()
    val withLogin = job.copy(headers = mapOf("X-Lelap-Netfs" to "secret"), revision = "r2")
    Downloads.writeJob(dir, withLogin)
    Downloads.dropLogin(dir, "r1")
    assertEquals(withLogin, Downloads.readJob(dir))
    Downloads.dropLogin(dir, "r2")
    assertEquals(withLogin.copy(headers = emptyMap()), Downloads.readJob(dir))
    dir.deleteRecursively()
  }

  @Test fun `refuses duplicate names, empty jobs and broken JSON`() {
    val twice = job.copy(files = listOf(job.files[0], job.files[0]))
    assertNull(DownloadJob.decode(twice.encode()))
    assertNull(DownloadJob.decode(job.copy(files = emptyList()).encode()))
    assertNull(DownloadJob.decode("{"))
  }
}

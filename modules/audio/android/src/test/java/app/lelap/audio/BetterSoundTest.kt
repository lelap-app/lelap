package app.lelap.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** M84: choosing the sound for a book, skip silence's time saved, ReplayGain and the new stages. */
class BetterSoundTest {
  private val rate = 48_000

  @Test fun aBooksOwnChoiceWinsOverTheDefault() {
    val defaults = SoundChoice(voiceEq = true, skipSilence = false, evenLoudness = true)
    assertEquals(defaults, defaults.with(null))
    assertEquals(defaults, defaults.with(SoundOverrides()))
    assertEquals(
      SoundChoice(voiceEq = false, skipSilence = true, evenLoudness = true),
      defaults.with(SoundOverrides(voiceEq = false, skipSilence = true)),
    )
  }

  @Test fun overridesTravelWithTheBookAndIgnoreJunk() {
    val o = SoundOverrides(skipSilence = true, evenLoudness = false)
    assertEquals(o, SoundOverrides.fromJson(o.toJson()))
    assertEquals(SoundOverrides(), SoundOverrides.fromJson(null))
    assertEquals(
      SoundOverrides(voiceEq = true),
      SoundOverrides.fromJson(JSONObject("""{"voiceEq":true,"skipSilence":"yes","evenLoudness":1}""")),
    )
  }

  @Test fun theQueueAndJournalKeepABooksSound() {
    val load = BookLoad(
      BookPlaylist(
        bookId = "b",
        title = "Emma",
        author = null,
        coverUri = null,
        files = listOf(BookFile("file:///1.mp3", "1.mp3", "One", 1000L)),
        chapters = emptyList(),
        speed = 1f,
        sound = SoundOverrides(skipSilence = true),
      ),
      startIndex = 0,
      startPositionMs = 0L,
    )
    assertEquals(load, PositionJournal.decodeLoad(PositionJournal.encodeLoad(load)))
    // From the app, before M84: no sound, so the defaults hold.
    val older = JSONObject(PositionJournal.encodeLoad(load)).apply { remove("sound") }.toString()
    assertEquals(SoundOverrides(), PositionJournal.decodeLoad(older)?.playlist?.sound)
  }

  @Test fun skippedFramesSurviveTheCounterStartingAgain() {
    val frames = SkippedFrames()
    assertEquals(100L, frames.observe(100L))
    assertEquals(50L, frames.observe(150L))
    // A seek flushes: what was counted up to it is kept, then the counter starts from zero.
    assertEquals(30L, frames.flush(180L))
    assertEquals(20L, frames.observe(20L))
    // A restart not seen as a flush still loses nothing it counted after.
    assertEquals(5L, frames.observe(5L))
    assertEquals(0L, frames.observe(5L))
  }

  @Test fun skippedSilenceGoesToTheBookWhoseStreamItCameFrom() {
    val ledger = SilenceLedger()
    // Before any known stream nothing is counted.
    ledger.add(100L, 1_000)
    ledger.startStream("a")
    ledger.add(500L, 1_000)
    // The service banks on switching books, before the flush counts the old stream's tail.
    assertEquals(mapOf("a" to 500_000L), ledger.take())
    ledger.add(250L, 1_000)
    ledger.startStream("b")
    ledger.add(1_000L, 2_000)
    // A flush Media3 doesn't name (a reset) keeps the book.
    ledger.startStream(null)
    ledger.add(1_000L, 2_000)
    assertEquals(mapOf("a" to 250_000L, "b" to 1_000_000L), ledger.take())
    assertEquals(emptyMap<String, Long>(), ledger.take())
  }

  @Test fun eachPartKeepsItsOwnReplayGain() {
    val gains = StreamGains(max = 2)
    gains.put("part 1", -4f)
    gains.put("part 2", null)
    assertEquals(-4f, gains.gainDb("part 1"), 0f)
    assertTrue(gains.gainDb("part 2").isNaN())
    // Unknown, or long gone: measured instead.
    gains.put("part 3", 2f)
    assertTrue(gains.gainDb("part 1").isNaN())
    assertTrue(gains.gainDb("other").isNaN())
    assertEquals(2f, gains.gainDb("part 3"), 0f)
  }

  @Test fun replayGainComesFromAFormatsMetadata() {
    val metadata = androidx.media3.common.Metadata(
      androidx.media3.extractor.metadata.id3.TextInformationFrame("TXXX", "REPLAYGAIN_TRACK_GAIN", listOf("-7.5 dB")),
      androidx.media3.extractor.metadata.vorbis.VorbisComment("REPLAYGAIN_ALBUM_GAIN", "-3 dB"),
    )
    assertEquals(-3f, ReplayGain.gainDb(metadata)!!, 0f)
    assertNull(ReplayGain.gainDb(null as androidx.media3.common.Metadata?))
  }

  @Test fun timeSavedCountsAtTheListeningSpeed() {
    val savings = SilenceSavings()
    savings.add("b", 4_000_000L, 1f)
    savings.add("b", 4_000_000L, 2f)
    savings.add("c", 0L, 1f)
    assertEquals(6_000L, savings.savedMs("b"))
    assertEquals(0L, savings.savedMs("c"))
    assertEquals(6_000L, SilenceSavings.decode(savings.encode()).savedMs("b"))
    assertEquals(0L, SilenceSavings.decode("not json").savedMs("b"))
  }

  @Test fun timeSavedKeepsTheNewestBooks() {
    val savings = SilenceSavings(max = 2)
    savings.add("a", 1_000_000L, 1f)
    savings.add("b", 1_000_000L, 1f)
    savings.add("a", 1_000_000L, 1f)
    savings.add("c", 1_000_000L, 1f)
    val again = SilenceSavings.decode(savings.encode(), max = 2)
    assertEquals(2_000L, again.savedMs("a"))
    assertEquals(0L, again.savedMs("b"))
    assertEquals(1_000L, again.savedMs("c"))
  }

  @Test fun replayGainPrefersTheAlbumAndReadsEveryContainer() {
    assertEquals(
      -3.2f,
      ReplayGain.gainDb(listOf("REPLAYGAIN_TRACK_GAIN" to "-6.5 dB", "replaygain_album_gain" to "-3.20 dB"))!!,
      1e-4f,
    )
    assertEquals(4.1f, ReplayGain.gainDb(listOf("replaygain_track_gain" to "+4.10 dB"))!!, 1e-4f)
    // Opus: Q7.8 against -23 LUFS.
    assertEquals(3f, ReplayGain.gainDb(listOf("R128_TRACK_GAIN" to "-512"))!!, 1e-4f)
    assertNull(ReplayGain.gainDb(listOf("REPLAYGAIN_TRACK_GAIN" to "loud")))
    assertNull(ReplayGain.gainDb(listOf("REPLAYGAIN_TRACK_GAIN" to "-60 dB")))
    assertNull(ReplayGain.gainDb(listOf("TITLE" to "Emma")))
  }

  private fun speech(frames: Int, amplitude: Float, channels: Int = 2): FloatArray =
    FloatArray(frames * channels) {
      val t = (it / channels).toDouble() / rate
      // A 4 Hz syllable envelope over a 200 Hz voice.
      (amplitude * (0.6 + 0.4 * sin(2 * PI * 4 * t)) * sin(2 * PI * 200 * t)).toFloat()
    }

  private fun rmsDb(samples: FloatArray, from: Int = 0): Double {
    var sum = 0.0
    for (i in from until samples.size) sum += samples[i].toDouble() * samples[i]
    return 20 * log10(sqrt(sum / (samples.size - from)))
  }

  private fun levelled(amplitude: Float, seconds: Int = 20): Double {
    val chain = SoundChain().apply { evenLoudness = true }
    chain.configure(rate, 2)
    val samples = speech(rate * seconds, amplitude)
    chain.process(samples, rate * seconds)
    return rmsDb(samples, samples.size - rate * 4)
  }

  @Test fun evenLoudnessBringsQuietAndLoudBooksTogether() {
    val quiet = levelled(0.1f)
    val loud = levelled(0.6f)
    // 15 dB apart going in; within a couple of dB coming out, near the target.
    assertTrue("quiet $quiet loud $loud", abs(quiet - loud) < 2.5)
    assertEquals(Leveller.TARGET_DB.toDouble(), loud, 2.5)
    // A whisper of a recording is lifted by no more than the limit.
    val whisper = levelled(0.02f) - rmsDb(speech(rate * 4, 0.02f))
    assertEquals(Leveller.MAX_LIFT_DB.toDouble(), whisper, 0.3)
  }

  @Test fun evenLoudnessIgnoresSilence() {
    val chain = SoundChain().apply { evenLoudness = true }
    chain.configure(rate, 2)
    val hiss = FloatArray(rate * 10 * 2) { if (it % 2 == 0) 1e-4f else -1e-4f }
    chain.process(hiss, rate * 10)
    assertEquals(0f, chain.loudnessGainDb, 0.01f)
  }

  @Test fun evenLoudnessUsesReplayGainWhenTheFileHasIt() {
    val chain = SoundChain().apply {
      evenLoudness = true
      replayGainDb = -6f
    }
    chain.configure(rate, 2)
    val samples = speech(rate * 10, 0.3f)
    chain.process(samples, rate * 10)
    assertEquals(-6f, chain.loudnessGainDb, 0.1f)
  }

  @Test fun evenLoudnessMeasuresANewBookAfresh() {
    val chain = SoundChain().apply { evenLoudness = true }
    chain.configure(rate, 2)
    chain.process(speech(rate * 20, 0.02f), rate * 20)
    val lifted = chain.loudnessGainDb
    chain.restartLoudness()
    chain.process(speech(rate * 20, 0.5f), rate * 20)
    assertTrue("lifted $lifted", lifted > 5f)
    assertTrue("now ${chain.loudnessGainDb}", chain.loudnessGainDb < 0f)
  }

  @Test fun voiceBoostNarrowsTheGapBetweenSoftAndLoudWords() {
    fun through(amplitude: Float): Double {
      val chain = SoundChain().apply { voiceEq = true }
      chain.configure(rate, 2)
      val samples = speech(rate * 2, amplitude)
      chain.process(samples, rate * 2)
      return rmsDb(samples, rate)
    }
    val soft = through(0.03f)
    val loud = through(0.6f)
    val inputGap = 20 * log10(0.6 / 0.03)
    assertTrue("gap ${loud - soft} of $inputGap", loud - soft < inputGap - 6)
  }

  @Test fun compressorLiftsQuietAndHoldsBackLoud() {
    val quiet = Compressor(rate)
    val loud = Compressor(rate)
    var quietGain = 0f
    var loudGain = 0f
    repeat(rate) {
      quietGain = quiet.gainFor(0.01f)
      loudGain = loud.gainFor(0.9f)
    }
    assertEquals(Compressor.MAKEUP_DB, 20 * log10(quietGain), 0.1f)
    assertTrue("loud ${20 * log10(loudGain)}", 20 * log10(loudGain) < -5f)
  }

  @Test fun everyStageTogetherStaysUnderFullScale() {
    val chain = SoundChain().apply {
      voiceEq = true
      evenLoudness = true
      boost = true
      replayGainDb = 10f
    }
    chain.configure(rate, 2)
    val samples = speech(rate * 3, 0.9f)
    chain.process(samples, rate * 3)
    assertTrue(samples.maxOf { abs(it) } <= SoftLimiter.CEILING + 1e-6f)
  }
}

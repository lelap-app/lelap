package app.lelap.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AbiChoiceTest {
  private val both = listOf("arm64-v8a", "armeabi-v7a")

  @Test fun phoneThatRunsBothTakes64Bit() {
    assertEquals("arm64-v8a", AbiChoice.pick(listOf("arm64-v8a", "armeabi-v7a", "armeabi"), both))
  }

  @Test fun phoneThatRunsOnly64BitTakes64Bit() {
    assertEquals("arm64-v8a", AbiChoice.pick(listOf("arm64-v8a"), both))
  }

  @Test fun phoneThatRunsOnly32BitTakes32Bit() {
    assertEquals("armeabi-v7a", AbiChoice.pick(listOf("armeabi-v7a", "armeabi"), both))
  }

  @Test fun orderInTheReleaseDoesNotMatter() {
    assertEquals("arm64-v8a", AbiChoice.pick(listOf("arm64-v8a", "armeabi-v7a"), both.reversed()))
  }

  @Test fun takes32BitWhenThatIsAllTheReleaseHas() {
    assertEquals(
      "armeabi-v7a",
      AbiChoice.pick(listOf("arm64-v8a", "armeabi-v7a"), listOf("armeabi-v7a")),
    )
  }

  @Test fun nothingForADeviceTheReleaseDoesNotCover() {
    assertNull(AbiChoice.pick(listOf("x86_64", "x86"), both))
    assertNull(AbiChoice.pick(listOf("arm64-v8a"), listOf("armeabi-v7a")))
    assertNull(AbiChoice.pick(listOf("arm64-v8a"), emptyList()))
  }
}

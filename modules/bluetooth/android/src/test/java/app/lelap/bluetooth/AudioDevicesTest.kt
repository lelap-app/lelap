package app.lelap.bluetooth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioDevicesTest {
  @Test
  fun keepsAudioDevicesOnly() {
    val devices = AudioDevices()
    assertTrue(devices.connect("a", "Buds", 0x0400, 0x0418, 80))
    // A watch (wearable class) is not an audio output.
    assertFalse(devices.connect("w", "Watch", 0x0700, 0x0704, 50))
    assertEquals(listOf("a"), devices.list.map { it.id })
    assertEquals(80, devices.list.single().battery)
  }

  @Test
  fun recognisesCars() {
    val devices = AudioDevices()
    devices.connect("car", "My car", 0x0400, 0x0420, null)
    devices.connect("kit", "Hands-free", 0x0400, 0x0408, null)
    devices.connect("hp", "Headphones", 0x0400, 0x0418, null)
    assertEquals(listOf(true, true, false), devices.list.map { it.car })
  }

  @Test
  fun batteryReportsOnlyForKnownDevicesAndValidLevels() {
    val devices = AudioDevices()
    assertFalse(devices.battery("a", 50))
    devices.connect("a", "Buds", null, null, -1)
    assertNull(devices.list.single().battery)
    assertTrue(devices.battery("a", 40))
    assertEquals(40, devices.list.single().battery)
    assertFalse(devices.battery("a", 40))
    assertTrue(devices.battery("a", -1))
    assertNull(devices.list.single().battery)
  }

  @Test
  fun forgetsDisconnectedDevices() {
    val devices = AudioDevices()
    devices.connect("a", "", null, null, 70)
    assertEquals("", devices.list.single().name)
    assertTrue(devices.disconnect("a"))
    assertFalse(devices.disconnect("a"))
    assertTrue(devices.list.isEmpty())
  }
}

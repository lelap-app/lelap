package app.lelap.audio

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PartRecord : Record {
  @Field val url: String = ""
  @Field val title: String = ""
}

class AudioModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LelapAudio")
    Events("onStateChange")

    AsyncFunction("load") { _: String, _: List<PartRecord>, _: Int -> }
    AsyncFunction("play") { }
    AsyncFunction("pause") { }
    AsyncFunction("seekBy") { _: Long -> }
    AsyncFunction("skipToPart") { _: Int -> }
    AsyncFunction("setSpeed") { _: Float -> }
    AsyncFunction("setDuckOnInterruption") { _: Boolean -> }
    AsyncFunction("startLull") { _: Double -> }
    AsyncFunction("cancelLull") { }
    AsyncFunction("getState") { mapOf("connected" to false) }
  }
}

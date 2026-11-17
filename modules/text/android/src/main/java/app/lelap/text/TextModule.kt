package app.lelap.text

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** The app hands over its lines for native text whenever the profile's language changes. */
class TextModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapText")

    Function("setLines") { language: String, lines: Map<String, String> ->
      val catalog = NativeCatalog(language, lines)
      if (catalog.encode() == NativeText.get(context).encode()) return@Function
      NativeText.save(context, catalog)
    }
  }
}

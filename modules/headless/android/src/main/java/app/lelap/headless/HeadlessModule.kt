package app.lelap.headless

import expo.modules.interfaces.taskManager.TaskManagerInterface
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val MESSAGE_EVENT = "onMessage"

class HeadlessModule : Module() {
  private var sandbox: HeadlessSandbox? = null

  private fun sandbox(): HeadlessSandbox = sandbox ?: HeadlessSandbox(
    appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost(),
  ) { key, data -> sendEvent(MESSAGE_EVENT, mapOf("key" to key, "data" to data)) }.also { sandbox = it }

  override fun definition() = ModuleDefinition {
    Name("LelapHeadless")
    Events(MESSAGE_EVENT)

    Function("openSandbox") { key: String, html: String -> sandbox().open(key, html); Unit }

    Function("postToSandbox") { key: String, message: String -> sandbox?.post(key, message); Unit }

    Function("closeSandbox") { key: String -> sandbox?.close(key); Unit }

    // The playback service asks for the task by its consumer, so the name is the app's to pick.
    AsyncFunction("registerServerTask") { name: String ->
      val manager = appContext.legacyModule<TaskManagerInterface>()
        ?: throw IllegalStateException("expo-task-manager is missing")
      manager.registerTask(name, ServerTaskConsumer::class.java, emptyMap())
    }

    OnDestroy { sandbox?.closeAll() }
  }
}

package app.lelap.headless

import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import expo.modules.interfaces.taskManager.TaskConsumer
import expo.modules.interfaces.taskManager.TaskConsumerInterface
import expo.modules.interfaces.taskManager.TaskExecutionCallback
import expo.modules.interfaces.taskManager.TaskInterface
import expo.modules.interfaces.taskManager.TaskManagerUtilsInterface
import expo.modules.interfaces.taskManager.TaskServiceProviderHelper
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * The app's server tasks, asked for by the playback service with the app closed (M123): send the
 * place of a pause to the book's server, ask an add-on where a book it started streams from, or
 * add and play an add-on's item picked by voice or in Android Auto's search results (M147).
 * They run the app's JavaScript task (`apps/app/src/background.ts`), starting the app without a
 * screen when it isn't running, through expo-task-manager like the hourly refresh.
 */
object ServerTasks {
  const val PLACES = "places"
  const val LOCATE = "locate"
  const val PLAY = "play"

  private const val TAG = "LelapServerTasks"

  /** A pause, then play again soon after, sends one place, not two. */
  const val PLACES_DELAY_MS = 10_000L

  /** One unique work per kind: a newer pause or book replaces the request that still waits. */
  fun workName(kind: String) = "lelap-server-task-$kind"

  /** How long the work waits for the app's task; it gives up quietly after. */
  fun timeoutMs(kind: String) = if (kind == LOCATE || kind == PLAY) 60_000L else 3 * 60_000L

  /** [itemType] and [itemId] name the add-on item that [PLAY] adds to the library and plays. */
  fun request(context: Context, kind: String, bookId: String? = null, itemType: String? = null, itemId: String? = null) {
    try {
      val work = OneTimeWorkRequestBuilder<ServerTaskWork>()
        .setInputData(workDataOf("kind" to kind, "bookId" to bookId, "type" to itemType, "id" to itemId))
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setInitialDelay(if (kind == PLACES) PLACES_DELAY_MS else 0L, TimeUnit.MILLISECONDS)
        .build()
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(workName(kind), ExistingWorkPolicy.REPLACE, work)
    } catch (e: Exception) {
      // The hourly refresh, or the app's next start, still sends what waits.
      Log.w(TAG, "Could not ask for $kind: ${e.message}")
    }
  }
}

/** Registered by the app (`registerServerTask`) for its JavaScript task; holds that task. */
class ServerTaskConsumer(context: Context?, taskManagerUtils: TaskManagerUtilsInterface?) :
  TaskConsumer(context, taskManagerUtils), TaskConsumerInterface {
  private var task: TaskInterface? = null

  override fun taskType(): String = "lelap-server-task"

  override fun didRegister(task: TaskInterface) {
    this.task = task
  }

  override fun didUnregister() {
    task = null
  }

  /** Runs the app's task with [data]; false when the app never registered one. */
  fun run(data: Bundle, callback: TaskExecutionCallback): Boolean {
    val registered = task ?: return false
    taskManagerUtils.executeTask(registered, data, callback)
    return true
  }
}

class ServerTaskWork(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val kind = inputData.getString("kind") ?: return Result.success()
    val service = TaskServiceProviderHelper.getTaskServiceImpl(applicationContext) ?: return Result.success()
    val consumer = service.getTaskConsumers(applicationContext.packageName)
      .filterIsInstance<ServerTaskConsumer>()
      .firstOrNull() ?: return Result.success()
    val data = Bundle().apply {
      putString("kind", kind)
      inputData.getString("bookId")?.let { putString("bookId", it) }
      inputData.getString("type")?.let { putString("type", it) }
      inputData.getString("id")?.let { putString("id", it) }
    }
    val done = CompletableDeferred<Unit>()
    if (!consumer.run(data) { done.complete(Unit) }) return Result.success()
    // The work keeps the process alive while the app's task runs; it never retries, since what
    // failed waits in the app's outbox for the next try.
    withTimeoutOrNull(ServerTasks.timeoutMs(kind)) { done.await() }
    return Result.success()
  }
}

import { sql } from 'drizzle-orm';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { db } from './db';
import { refreshPodcasts } from './podcasts';
import { loadActiveProfile } from './profile';
import { syncOnce } from './sync';

const TASK = 'lelap-background-refresh';
// Android runs it about this often, when the network is up and the battery is not low.
const EVERY_MINUTES = 60;

// Defined when this module loads, so a background run without the UI can find it.
TaskManager.defineTask(TASK, async () => {
  try {
    // Without the UI no migration step ran; switch foreign keys on as the app does after it.
    db.run(sql`pragma foreign_keys = on`);
    loadActiveProfile();
    // New episodes, then auto-downloads (inside refreshPodcasts), then sync.
    await refreshPodcasts(true);
    await syncOnce();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Asks Android to run the refresh in the background from now on. */
export async function registerBackgroundRefresh(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
}

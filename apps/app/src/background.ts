import { appErrorEvent } from '@lelap/core';
import { sql } from 'drizzle-orm';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { refreshWanted } from './availability';
import { db } from './db';
import { loadDiagnosticsSwitch, logDiagnostic } from './diagnostics';
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
    // The app reads the switch when its UI opens, which a background run never does.
    loadDiagnosticsSwitch();
    // New episodes, then auto-downloads (inside refreshPodcasts), then sync.
    await refreshPodcasts(true, true);
    await syncOnce();
    // Last: it asks add-ons, and a slow one must not hold up the rest.
    await refreshWanted().catch(() => {});
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    logDiagnostic(appErrorEvent(error, 'error'));
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Asks Android to run the refresh in the background from now on. */
export async function registerBackgroundRefresh(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
}

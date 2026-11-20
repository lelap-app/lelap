import { appErrorEvent } from '@lelap/core';
import { sql } from 'drizzle-orm';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { addWork } from './addons';
import { refreshWanted } from './availability';
import { db } from './db';
import { loadDiagnosticsSwitch, logDiagnostic } from './diagnostics';
import { registerServerTask } from './platform/headless';
import { foldJournal, playBook, relocateBook } from './player';
import { refreshPodcasts } from './podcasts';
import { loadActiveProfile } from './profile';
import { flushServerPlaces } from './serverPlaces';
import { syncOnce } from './sync';

const TASK = 'lelap-background-refresh';
// Android runs it about this often, when the network is up and the battery is not low.
const EVERY_MINUTES = 60;
// Asked for by the playback service (M123, `@lelap/headless`): `places` after a pause of a book
// whose server keeps places, `locate` after it started a book from an add-on server by itself,
// `play` for an add-on's item found by voice or in Android Auto's search (M147).
const SERVER_TASK = 'lelap-server-task';

/** What a run without the UI needs first; harmless when the UI is up too. */
function prepare(): void {
  // Without the UI no migration step ran; switch foreign keys on as the app does after it.
  db.run(sql`pragma foreign_keys = on`);
  loadActiveProfile();
  // The app reads the switch when its UI opens, which a background run never does.
  loadDiagnosticsSwitch();
}

// Defined when this module loads, so a background run without the UI can find it.
TaskManager.defineTask(TASK, async () => {
  try {
    prepare();
    // Places the player saved with the app closed reach their servers (M100); add-on servers'
    // run in a sandbox without a screen (M123).
    await foldJournal(false).catch(() => {});
    await flushServerPlaces(true);
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

TaskManager.defineTask<{ kind?: string; bookId?: string; type?: string; id?: string }>(
  SERVER_TASK,
  async ({ data }) => {
    try {
      prepare();
      if (data?.kind === 'locate' && data.bookId) {
        await relocateBook(data.bookId);
      } else if (data?.kind === 'play' && data.type && data.id) {
        // Added as the item's Play button adds it, then played from its place.
        await playBook(await addWork(data.type, data.id));
      } else {
        // With the app on screen its own player reports already queued the pause.
        if (AppState.currentState !== 'active') await foldJournal(false).catch(() => {});
        await flushServerPlaces(true);
      }
    } catch (error) {
      logDiagnostic(appErrorEvent(error, 'error'));
    }
  },
);

/** Asks Android to run the refresh in the background from now on, and lets the service ask. */
export async function registerBackgroundRefresh(): Promise<void> {
  // Every start: the service finds the task by it, and a new install of the app has none yet.
  await registerServerTask(SERVER_TASK).catch(() => {});
  if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MINUTES });
}

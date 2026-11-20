// A new deploy installs its service worker (`web/sw.js`) next to the old one, and the worker
// waits until every tab is closed; a plain reload keeps the old build. This finds a waiting
// worker and lets the listener take it: it never reloads by itself, so playback goes on (M141).
import { useEffect, useState } from 'react';

export type WebUpdate = { reload: () => void; dismiss: () => void };

/** How often an open tab asks whether a new build was deployed. */
const CHECK_MS = 30 * 60 * 1000;

type State = { ready: boolean; worker: ServiceWorker | null; dismissed: boolean };

let state: State = { ready: false, worker: null, dismissed: false };
const listeners = new Set<() => void>();
let started = false;
let reloading = false;

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function start(): void {
  if (started || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  started = true;
  const container = navigator.serviceWorker;
  // The first visit's worker claims the tab too; that is not an update.
  let hadController = container.controller !== null;

  container.addEventListener('controllerchange', () => {
    if (reloading) {
      location.reload();
      return;
    }
    // Another tab took the new build: this one runs old code against it until it reloads.
    if (hadController) set({ ready: true, worker: null, dismissed: false });
    hadController = true;
  });

  void container.ready.then((registration) => {
    const offer = (worker: ServiceWorker | null): void => {
      if (worker && container.controller) set({ ready: true, worker, dismissed: false });
    };
    offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(worker);
      });
    });
    let checked = Date.now();
    const check = (): void => {
      checked = Date.now();
      registration.update().catch(() => {});
    };
    setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - checked > CHECK_MS) check();
    });
  });
}

function reload(): void {
  const worker = state.worker;
  if (!worker || worker.state === 'redundant') {
    location.reload();
    return;
  }
  reloading = true;
  // The worker handles this with skipWaiting(); the page reloads on `controllerchange`.
  worker.postMessage({ type: 'lelap-skip-waiting' });
}

/** The offer of a new build, or null while there is none or the listener said Not now. */
export function useWebUpdate(): WebUpdate | null {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    const listener = () => setCurrent(state);
    listeners.add(listener);
    start();
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  if (!current.ready || current.dismissed) return null;
  return { reload, dismiss: () => set({ dismissed: true }) };
}

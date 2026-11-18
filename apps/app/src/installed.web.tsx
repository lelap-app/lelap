import { useRouter } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';

import { usePlayerState } from './player';

// The web app as an installed app: its window title, shortcuts from the app icon's menu and the
// browser's own Install prompt, offered in Settings.

type InstallPrompt = Event & { prompt: () => Promise<void> };
type LaunchParams = { targetURL?: string };
type LaunchQueue = { setConsumer: (consumer: (params: LaunchParams) => void) => void };

let installPrompt: InstallPrompt | null = null;
const promptListeners = new Set<() => void>();
const changed = () => {
  for (const listener of promptListeners) listener();
};

// Chromium browsers fire this once per page load, early: it is caught here, at start-up.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });
}

const subscribe = (listener: () => void) => {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
};

/** The browser's Install dialog, or null when it has none to offer (installed, or not Chromium). */
export function useInstall(): (() => Promise<void>) | null {
  const prompt = useSyncExternalStore(
    subscribe,
    () => installPrompt,
    () => null,
  );
  if (!prompt) return null;
  return async () => {
    await prompt.prompt();
    // A prompt is good for one try; the browser offers a new one on a later visit.
    installPrompt = null;
    changed();
  };
}

const APP_NAME = 'Lelap';

/** The window shows the book loaded, so the installed app reads well in the task switcher. */
export function windowTitle(bookTitle: string | null, playing: boolean): string {
  if (!bookTitle) return APP_NAME;
  return `${playing ? '▶ ' : ''}${bookTitle} · ${APP_NAME}`;
}

export function InstalledAppHost() {
  const router = useRouter();
  const { bookTitle, playing } = usePlayerState();
  const title = windowTitle(bookTitle, playing);

  useEffect(() => {
    document.title = title;
    // Navigation may set its own title on a screen change; the book's wins.
    const head = document.querySelector('title');
    if (!head) return;
    const observer = new MutationObserver(() => {
      if (document.title !== title) document.title = title;
    });
    observer.observe(head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [title]);

  useEffect(() => {
    // A shortcut from the app icon's menu opens in the window already open (`launch_handler` in
    // the manifest), so the book playing there keeps playing.
    const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer((params) => {
      if (!params.targetURL) return;
      const url = new URL(params.targetURL);
      if (url.origin !== location.origin) return;
      const path = `${url.pathname}${url.search}`;
      if (path !== `${location.pathname}${location.search}`) router.navigate(path as never);
    });
  }, [router]);

  return null;
}

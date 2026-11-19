import { type EventSubscription, NativeModule, requireNativeModule } from 'expo';

type Events = {
  onMessage: (event: { key: string; data: string }) => void;
};

declare class LelapHeadlessModule extends NativeModule<Events> {
  openSandbox(key: string, html: string): void;
  postToSandbox(key: string, message: string): void;
  closeSandbox(key: string): void;
  registerServerTask(name: string): Promise<void>;
}

const native = requireNativeModule<LelapHeadlessModule>('LelapHeadless');

/**
 * Starts an in-app add-on's page in a WebView that needs no screen, with the same settings as the
 * app's own sandbox. A page with that key already open starts again.
 */
export const openSandbox = (key: string, html: string): void => native.openSandbox(key, html);

/** Hands the page a message, as react-native-webview's `postMessage` does. */
export const postToSandbox = (key: string, message: string): void =>
  native.postToSandbox(key, message);

export const closeSandbox = (key: string): void => native.closeSandbox(key);

/** What a page sends with `window.ReactNativeWebView.postMessage`. */
export function addSandboxListener(
  listener: (key: string, data: string) => void,
): EventSubscription {
  return native.addListener('onMessage', (event) => listener(event.key, event.data));
}

/**
 * Lets the playback service run the task named `name` (defined with expo-task-manager) with the
 * app closed: `{ kind: 'places' }` after a pause, `{ kind: 'locate', bookId }` after it started a
 * book by itself. Kept across restarts; call it at every start.
 */
export const registerServerTask = (name: string): Promise<void> => native.registerServerTask(name);

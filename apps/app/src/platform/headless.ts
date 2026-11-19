import * as headless from '@lelap/headless';

/** Add-on sandboxes that need no screen (M123): a WebView of their own, never shown. */
export const screenlessSandbox: {
  open: (key: string, html: string) => void;
  post: (key: string, message: string) => void;
  close: (key: string) => void;
  listen: (listener: (key: string, data: string) => void) => void;
} | null = {
  open: headless.openSandbox,
  post: headless.postToSandbox,
  close: headless.closeSandbox,
  listen: (listener) => void headless.addSandboxListener(listener),
};

export const registerServerTask = headless.registerServerTask;

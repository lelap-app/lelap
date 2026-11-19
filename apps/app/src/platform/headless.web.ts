// A browser runs the app only in its tab, where the sandbox has its frame.
export const screenlessSandbox: {
  open: (key: string, html: string) => void;
  post: (key: string, message: string) => void;
  close: (key: string) => void;
  listen: (listener: (key: string, data: string) => void) => void;
} | null = null;

export const registerServerTask = (name: string): Promise<void> => Promise.resolve(void name);

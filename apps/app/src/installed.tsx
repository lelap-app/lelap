// The installed web app's extras (installed.web.tsx); Android has its own window and launcher.

export function useInstall(): (() => Promise<void>) | null {
  return null;
}

export function InstalledAppHost() {
  return null;
}

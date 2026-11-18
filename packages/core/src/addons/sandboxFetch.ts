import { hostAllowed } from './local';

// The app's half of `lelap.fetch` for add-ons inside the app (M38): only to declared hosts,
// without the app's cookies, and never following a redirect. A followed redirect would carry a
// posted body (a login) or the add-on's headers (a cookie, a token) to wherever it points: React
// Native's own fetch can't be told not to follow, so the app passes `expo/fetch`, which can.

/** What `lelap.fetch` hands the sandbox back. */
export type SandboxFetchReply =
  { status: number; text: string; headers: Record<string, string> } | { error: string };

export type SandboxFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

/** A `fetch` that honours `redirect: 'manual'` and `credentials: 'omit'`. */
export type ManualFetch = (
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    credentials: 'omit';
    redirect: 'manual';
  },
) => Promise<{
  status: number;
  type?: string;
  url?: string;
  headers: { get: (name: string) => string | null };
  text: () => Promise<string>;
}>;

export async function sandboxFetch(
  fetch: ManualFetch,
  url: string,
  init: SandboxFetchInit | undefined,
  hosts: string[],
  options: { timeoutMs: number; maxChars: number; tooLarge: string },
): Promise<SandboxFetchReply> {
  if (!hostAllowed(url, hosts)) {
    return { error: `Not allowed: this add-on may only reach ${hosts.join(', ') || 'nothing'}.` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      signal: controller.signal,
      // Never the app's own cookies or credentials.
      credentials: 'omit',
      redirect: 'manual',
    });
    // A browser hides a redirect it didn't follow as status 0 (`opaqueredirect`).
    if (
      response.type === 'opaqueredirect' ||
      response.status === 0 ||
      (response.status >= 300 && response.status < 400)
    ) {
      return {
        error: 'Not allowed: the server answered with a redirect, which add-ons don’t follow.',
      };
    }
    // Belt and braces: an answer from another host is never handed to the add-on.
    if (response.url && !hostAllowed(response.url, hosts)) {
      return { error: 'Not allowed: the answer came from another host.' };
    }
    const text = await response.text();
    if (text.length > options.maxChars) return { error: options.tooLarge };
    const type = response.headers.get('content-type');
    // A login's cookie, for an add-on that signs in with one (M61). Only on Android: a browser
    // never shows it to a page.
    const cookie = response.headers.get('set-cookie');
    // The server's clock, for an add-on that compares its times with the phone's (M65).
    const date = response.headers.get('date');
    return {
      status: response.status,
      text,
      headers: {
        ...(type ? { 'content-type': type } : {}),
        ...(cookie ? { 'set-cookie': cookie } : {}),
        ...(date ? { date } : {}),
      },
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

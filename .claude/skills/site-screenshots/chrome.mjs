// The part of the Chrome DevTools Protocol needed to drive a headless Chrome: no Playwright or
// Puppeteer, so the screenshots need nothing beyond Node 24 (its built-in WebSocket) and Chrome.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const found = CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error('No Chrome found. Set CHROME to its executable.');
  return found;
}

/** Starts headless Chrome with a throwaway profile, so no real library or sign-in is ever seen. */
export async function launchChrome() {
  const profile = await mkdtemp(join(tmpdir(), 'lelap-shots-chrome-'));
  const child = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--font-render-hinting=none',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start.')), 20_000);
    child.stderr.on('data', (chunk) => {
      text += chunk;
      const match = /DevTools listening on (ws:\S+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on('exit', () => reject(new Error(`Chrome quit:\n${text}`)));
    child.on('error', (error) => reject(new Error(`Chrome did not start: ${error.message}`)));
  });
  const browser = await connect(wsUrl);
  browser.close = async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    await rm(profile, { recursive: true, force: true });
  };
  return browser;
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} ${message.error.data ?? ''}`));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  };
  // If Chrome goes away mid-run, every waiting call fails instead of hanging.
  let closed = false;
  ws.onclose = () => {
    closed = true;
    for (const { reject } of pending.values()) reject(new Error('Chrome closed the connection.'));
    pending.clear();
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('Chrome closed the connection.'));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return {
    send,
    /** A new tab in its own browser context: its own storage, OPFS included. */
    async newPage({ width, height, scale }) {
      const { browserContextId } = await send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const page = pageApi(send, listeners, sessionId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: true,
      });
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      page.dispose = () => send('Target.disposeBrowserContext', { browserContextId });
      return page;
    },
  };
}

function pageApi(send, listeners, sessionId) {
  const errors = [];
  listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? 'error');
    }
  });
  const page = {
    errors,
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? expression);
      return result.value;
    },
    async goto(url) {
      await page.send('Page.navigate', { url });
      await page.waitFor(() => document.readyState === 'complete', 'the page to load');
    },
    /** Waits until `check`, a function run in the page, returns something truthy. */
    async waitFor(check, what, timeout = 20_000) {
      const end = Date.now() + timeout;
      for (;;) {
        const value = await page.eval(`(${check})()`).catch(() => null);
        if (value) return value;
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    /** The centre of the first visible element whose label or own text is `name` (or matches it). */
    async find(name, timeout, scroll = false) {
      const test =
        name instanceof RegExp
          ? `new RegExp(${JSON.stringify(name.source)}).test(text)`
          : `text === ${JSON.stringify(name)}`;
      const finder = `() => {
        const matches = (text) => text != null && ${test};
        const all = [...document.querySelectorAll('[aria-label], [role], div, span, button, a, input')];
        const hit = all.find((el) => {
          const own = el.children.length === 0 ? el.textContent.trim() : null;
          if (!matches(el.getAttribute('aria-label')) && !matches(own)) return false;
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        });
        if (!hit) return null;
        if (${scroll}) hit.scrollIntoView({ block: 'center' });
        const box = hit.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }`;
      return page.waitFor(finder, `“${String(name)}”`, timeout);
    },
    async has(name) {
      return page.find(name, 1).then(
        () => true,
        () => false,
      );
    },
    /** Waits until `measure`, run in the page, gives the same answer for `quiet` ms in a row. */
    async waitStill(measure, quiet = 2000, timeout = 15_000) {
      const end = Date.now() + timeout;
      let last = await page.eval(`(${measure})()`);
      let since = Date.now();
      while (Date.now() < end && Date.now() - since < quiet) {
        await new Promise((r) => setTimeout(r, 250));
        const now = await page.eval(`(${measure})()`);
        if (now !== last) [last, since] = [now, Date.now()];
      }
    },
    /** A real mouse click, which React Native Web's pressables answer to. */
    async click(name) {
      const { x, y } = await page.find(name, undefined, true);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 400));
    },
    async type(text) {
      await page.send('Input.insertText', { text });
    },
    async key(key) {
      for (const type of ['keyDown', 'keyUp']) {
        await page.send('Input.dispatchKeyEvent', {
          type,
          key,
          code: key,
          windowsVirtualKeyCode: 13,
        });
      }
    },
    /** A PNG of the viewport, or of `clip` (CSS pixels). */
    async screenshot(clip) {
      const { data } = await page.send('Page.captureScreenshot', {
        format: 'png',
        ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
      });
      return Buffer.from(data, 'base64');
    },
  };
  return page;
}

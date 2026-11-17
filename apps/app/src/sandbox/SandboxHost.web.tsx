import { createElement, useEffect, useRef, useSyncExternalStore } from 'react';

import { attachSandbox, type Box, currentBoxes, sandboxMessage, subscribeBoxes } from './index';

// Web: one hidden iframe per running in-app add-on, sandboxed to scripts only, so it has its own
// opaque origin: no cookies, storage or access to the app's page.

function Sandbox({ box }: { box: Box }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    attachSandbox(box.key, (message) => frame.contentWindow?.postMessage(message, '*'));
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && typeof event.data === 'string') {
        sandboxMessage(box.key, event.data);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [box.key]);
  return createElement('iframe', {
    ref,
    sandbox: 'allow-scripts',
    srcDoc: box.html,
    title: 'Add-on sandbox',
    'aria-hidden': true,
    style: {
      position: 'absolute',
      width: 1,
      height: 1,
      border: 0,
      opacity: 0,
      left: -10,
      top: -10,
    },
  });
}

/** Mounted once at the root; invisible. */
export function SandboxHost() {
  const boxes = useSyncExternalStore(subscribeBoxes, currentBoxes, currentBoxes);
  return createElement(
    'div',
    { style: { display: 'contents' } },
    boxes.map((box) => createElement(Sandbox, { key: box.key, box })),
  );
}

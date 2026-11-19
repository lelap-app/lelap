import { type ComponentType, type Ref, useEffect, useRef, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';

import {
  attachSandbox,
  type Box,
  currentBoxes,
  sandboxMessage,
  screenMounted,
  subscribeBoxes,
} from './index';

// Android: one hidden WebView per running in-app add-on. It loads only the inline page; any
// navigation is refused, and it has no file or content access and keeps nothing between runs.
// The add-on's code runs in a worker inside it (see page.ts), which can't navigate at all.

// react-native-webview 14's class typings don't fit React 19's; its own props type still does.
const Web = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebView> }>;

function Sandbox({ box }: { box: Box }) {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    attachSandbox(box.key, (message) => ref.current?.postMessage(message));
  }, [box.key]);
  return (
    <Web
      ref={ref}
      source={{ html: box.html, baseUrl: 'about:blank' }}
      // Every address passes the list so the check below decides: one that fails the list is
      // handed to the phone's browser instead, address and all.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(request) => request.url.startsWith('about:')}
      onMessage={(event) => sandboxMessage(box.key, event.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      incognito
      cacheEnabled={false}
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
      style={{ width: 1, height: 1 }}
    />
  );
}

/** Mounted once at the root; invisible. */
export function SandboxHost() {
  const all = useSyncExternalStore(subscribeBoxes, currentBoxes, currentBoxes);
  useEffect(() => screenMounted(), []);
  // Those started while no screen was up keep their own WebView (M123).
  const boxes = all.filter((box) => !box.screenless);
  if (boxes.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
        // layout: ltr; off screen and never seen, in either direction.
        left: -10,
        top: -10,
      }}
    >
      {boxes.map((box) => (
        <Sandbox key={box.key} box={box} />
      ))}
    </View>
  );
}

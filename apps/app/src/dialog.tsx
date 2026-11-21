import { useSyncExternalStore } from 'react';
import {
  Alert,
  type AlertButton,
  type AlertOptions,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';

import { t } from './i18n';
import { useReducedMotion } from './components/Motion';

// React Native's Alert does nothing on the web, so the web gets the same dialog drawn by the app.
// Android keeps the system dialog.

type Dialog = { title: string; message: string | undefined; buttons: AlertButton[] };

let current: Dialog | null = null;
const listeners = new Set<() => void>();

function set(next: Dialog | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** `Alert.alert` that also works on the web. */
export function showAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
): void {
  const list = buttons && buttons.length > 0 ? buttons : [{ text: t('OK') }];
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, list, options);
    return;
  }
  set({ title, message, buttons: list });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Mounted once at the root; draws the open dialog on the web. */
export function DialogHost() {
  const dialog = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const reduced = useReducedMotion();
  if (!dialog) return null;
  const cancel = dialog.buttons.find((b) => b.style === 'cancel');
  const close = (button?: AlertButton) => {
    set(null);
    button?.onPress?.();
  };

  return (
    <Modal
      transparent
      animationType={reduced ? 'none' : 'fade'}
      visible
      onRequestClose={() => close(cancel)}
      aria-label={dialog.title}
    >
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        {/* A sibling behind the dialog, not its parent: a button can't hold the dialog's buttons. */}
        <Pressable
          onPress={() => close(cancel)}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          className="absolute inset-0"
        />
        <View accessibilityRole="alert" className="w-full max-w-sm gap-3 rounded-2xl bg-raised p-5">
          <Text accessibilityRole="header" className="text-section font-semibold text-paper">
            {dialog.title}
          </Text>
          {dialog.message !== undefined && dialog.message !== '' && (
            <Text className="text-soft">{dialog.message}</Text>
          )}
          <View className="flex-row flex-wrap justify-end gap-2 pt-2">
            {dialog.buttons.map((button, index) => (
              <Pressable
                key={`${button.text ?? ''} ${index}`}
                onPress={() => close(button)}
                accessibilityRole="button"
                className="min-h-12 justify-center rounded-full px-4 active:bg-line"
              >
                <Text
                  className={`font-semibold ${
                    button.style === 'destructive'
                      ? 'text-danger'
                      : button.style === 'cancel'
                        ? 'text-muted'
                        : 'text-amber'
                  }`}
                >
                  {button.text ?? 'OK'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

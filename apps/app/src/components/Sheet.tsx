import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { useReducedMotion } from './Motion';

/** A bottom sheet over a dimmed backdrop; tapping the backdrop closes it. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      {/* A modal sits outside the activity's resize, so the sheet lifts itself above the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          className="flex-1 bg-black/60"
        />
        <View
          style={{ paddingBottom: insets.bottom + 12 }}
          className="max-h-[70%] rounded-t-2xl bg-raised px-4 pt-4"
        >
          <Text accessibilityRole="header" className="pb-3 text-lg font-semibold text-paper">
            {title}
          </Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

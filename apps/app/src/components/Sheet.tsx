import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { useWide } from '../layout';
import { useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { useReducedMotion } from './Motion';

/**
 * A bottom sheet over a dimmed backdrop; tapping the backdrop closes it. On a wide screen it is a
 * dialog in the middle instead, where a sheet rising from the bottom edge is far from the pointer.
 */
export function Sheet({
  visible,
  title,
  onClose,
  icon,
  children,
}: {
  visible: boolean;
  title: string;
  /** Drawn once beside the title, so the rows below don't each repeat it. */
  icon?: IconName;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const wide = useWide();
  const colors = useColors();
  const text = (
    <Text accessibilityRole="header" className="text-section font-semibold text-paper">
      {title}
    </Text>
  );
  const heading =
    icon === undefined ? (
      <View className="pb-3">{text}</View>
    ) : (
      <View className="flex-row items-center gap-2 pb-3">
        <Icon name={icon} size={20} color={colors.amber} />
        {text}
      </View>
    );
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : wide ? 'fade' : 'slide'}
      onRequestClose={onClose}
      // The web reads the dialog by this name when focus moves into it.
      aria-label={title}
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
          className={wide ? 'absolute inset-0 bg-black/60' : 'flex-1 bg-black/60'}
        />
        {wide ? (
          <View
            pointerEvents="box-none"
            style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
            className="flex-1 items-center justify-center px-6"
          >
            <View className="max-h-full w-full max-w-[480px] rounded-2xl bg-raised px-4 pb-4 pt-4">
              {heading}
              {children}
            </View>
          </View>
        ) : (
          <View
            style={{ paddingBottom: insets.bottom + 12 }}
            className="max-h-[70%] rounded-t-2xl bg-raised px-4 pt-4"
          >
            {heading}
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

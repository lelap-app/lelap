import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/60" />
      <View
        style={{ paddingBottom: insets.bottom + 12 }}
        className="max-h-[70%] rounded-t-2xl bg-raised px-4 pt-4"
      >
        <Text className="pb-3 text-lg font-semibold text-paper">{title}</Text>
        {children}
      </View>
    </Modal>
  );
}

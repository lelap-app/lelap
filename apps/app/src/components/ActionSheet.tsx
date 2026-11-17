import { Pressable, ScrollView, Text } from 'react-native';

import { COLORS, Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';

export type Action = { icon: IconName; label: string; onPress: () => void; danger?: boolean };

/** A menu of actions in a bottom sheet; the sheet closes before an action runs. */
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  /** Null hides the sheet. */
  title: string | null;
  actions: Action[];
  onClose: () => void;
}) {
  if (title === null) return null;
  return (
    <Sheet visible title={title} onClose={onClose}>
      <ScrollView>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            accessibilityRole="button"
            className="flex-row items-center gap-3 rounded-lg px-2 py-3 active:bg-line"
          >
            <Icon name={a.icon} size={22} color={a.danger ? COLORS.danger : COLORS.soft} />
            <Text className={a.danger ? 'text-danger' : 'text-paper'}>{a.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

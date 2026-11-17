import type { ReactNode } from 'react';
import { Pressable, type PressableProps, View } from 'react-native';

/**
 * A small rounded chip, such as a sort order or a tag, inside a 48-point touch area: the chip
 * keeps its size and the finger gets room around it. `className` styles the chip itself.
 */
export function Pill({
  className,
  children,
  accessibilityRole = 'button',
  ...props
}: Omit<PressableProps, 'children' | 'style'> & { className: string; children: ReactNode }) {
  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole}
      className="min-h-12 justify-center active:opacity-70"
    >
      <View className={className}>{children}</View>
    </Pressable>
  );
}

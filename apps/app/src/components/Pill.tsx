import type { ReactNode } from 'react';
import { Pressable, type PressableProps, View } from 'react-native';

/**
 * Splits `active:` classes off, since NativeWind applies them only to the Pressable itself. The
 * plain class (`bg-raised` for `active:bg-raised`) must be one the app uses elsewhere, so Tailwind
 * builds it.
 */
function splitPressed(className: string): { base: string; pressed: string } {
  const base: string[] = [];
  const pressed: string[] = [];
  for (const name of className.split(/\s+/)) {
    if (name.startsWith('active:')) pressed.push(name.slice('active:'.length));
    else if (name) base.push(name);
  }
  return { base: base.join(' '), pressed: [...base, ...pressed].join(' ') };
}

/**
 * A small rounded chip, such as a sort order or a tag, inside a 48-point touch area: the chip
 * keeps its size and the finger gets room around it. `className` styles the chip itself,
 * `active:` classes included.
 */
export function Pill({
  className,
  children,
  accessibilityRole = 'button',
  ...props
}: Omit<PressableProps, 'children' | 'style'> & { className: string; children: ReactNode }) {
  const classes = splitPressed(className);
  return (
    <Pressable
      {...props}
      accessibilityRole={accessibilityRole}
      className="min-h-12 min-w-12 items-center justify-center active:opacity-70"
    >
      {({ pressed }) => (
        <View className={pressed ? classes.pressed : classes.base}>{children}</View>
      )}
    </Pressable>
  );
}

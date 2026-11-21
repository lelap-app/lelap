import { type ComponentRef, type Ref, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { useColors } from '../theme';

/**
 * The app's one text field: bordered, 48 tall, text 12 in, the accent border while it has focus.
 * Give it `accessibilityLabel` when no visible label names it.
 */
export function TextField({
  className = '',
  mono = false,
  onFocus,
  onBlur,
  ref,
  ...props
}: Omit<TextInputProps, 'className'> & {
  /** Layout only, such as `flex-1` or `w-32`. */
  className?: string;
  /** For codes and keys, which are read character by character. */
  mono?: boolean;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.muted}
      {...props}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      className={`min-h-12 min-w-0 rounded-lg border px-3 py-2 text-body text-paper ${focused ? 'border-amber' : 'border-line'} ${mono ? 'font-mono' : ''} ${className}`}
    />
  );
}

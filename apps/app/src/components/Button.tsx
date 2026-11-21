import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { hint as hintProps } from '../a11y';
import { useColors } from '../theme';
import { Icon, type IconName } from './Icon';
import { TextButton } from './TextButton';

const KIND = {
  primary: { box: 'bg-amber active:opacity-80', text: 'font-semibold text-ink' },
  secondary: { box: 'border border-line active:opacity-70', text: 'font-medium text-paper' },
} as const;

/**
 * The app's one button. Primary for the main action of a screen, secondary beside a field or as
 * the second choice, text inside rows (that kind is `TextButton`). 48 tall in every kind and size;
 * disabled is an outline with muted text in every kind, since opacity would take the text below AA.
 */
export function Button({
  text,
  detail,
  onPress,
  kind = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  icon,
  accessibilityLabel,
  accessibilityRole = 'button',
  hint,
  className = '',
}: {
  text: string;
  /** A second, smaller line under the text, such as the time a choice goes back to. */
  detail?: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'text';
  size?: 'md' | 'sm';
  disabled?: boolean;
  /** Shows a spinner in place of the text while the press is being handled. */
  busy?: boolean;
  icon?: IconName;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  hint?: string;
  /** Layout only, such as `self-start` or `flex-1`. */
  className?: string;
}) {
  const colors = useColors();
  if (kind === 'text') {
    return (
      <TextButton
        text={text}
        onPress={onPress}
        disabled={disabled || busy}
        className={className}
        {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      />
    );
  }
  const look = KIND[kind];
  const off = disabled || busy;
  const ink = disabled ? colors.muted : kind === 'primary' ? colors.ink : colors.paper;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? (detail ? `${text}, ${detail}` : text)}
      accessibilityState={{ disabled: off, busy }}
      {...hintProps(hint)}
      className={`min-h-12 flex-row items-center justify-center gap-2 ${detail ? 'rounded-xl py-2' : 'rounded-full'} ${size === 'sm' ? 'px-4' : 'px-6'} ${disabled ? 'border border-line' : look.box} ${className}`}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon && (
            <View aria-hidden>
              <Icon name={icon} size={18} color={ink} />
            </View>
          )}
          <View className={detail ? 'shrink items-center' : 'shrink'}>
            <Text
              className={`text-center ${size === 'sm' ? 'text-detail' : 'text-body'} ${disabled ? 'font-medium text-muted' : look.text}`}
            >
              {text}
            </Text>
            {detail !== undefined && (
              <Text
                className={`text-center text-detail ${disabled ? 'text-muted' : kind === 'primary' ? 'text-ink' : 'text-soft'}`}
              >
                {detail}
              </Text>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}

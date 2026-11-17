import { createContext, useContext } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  Switch,
  type SwitchProps,
  Text,
} from 'react-native';

/**
 * The role of a row that holds buttons of its own, such as the mini player with Play. Android
 * announces it as a button; the web leaves the role out, since a <button> can't hold another.
 */
export const ROW_BUTTON =
  Platform.OS === 'web' ? {} : ({ accessibilityRole: 'button' } as const satisfies PressableProps);

const TONE = { amber: 'text-amber', muted: 'text-muted', danger: 'text-danger' } as const;

/**
 * The label of the settings row a control sits in. A screen reader names a switch by it, and a
 * short button such as “Open” gets it as its hint, so “Open” is never said without its row.
 */
export const RowLabel = createContext<string | undefined>(undefined);

/**
 * A text-only button, such as “Open” at the end of a settings row. At least 48 points tall so a
 * finger finds it; `accessibilityLabel` names it when the text alone says too little.
 */
export function TextButton({
  text,
  onPress,
  disabled = false,
  tone = 'amber',
  accessibilityLabel,
  className = '',
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  accessibilityLabel?: string;
  className?: string;
}) {
  const row = useContext(RowLabel);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...(row === undefined ? {} : { accessibilityHint: row })}
      className={`min-h-12 min-w-12 items-center justify-center ${className}`}
    >
      <Text className={disabled ? 'text-muted' : TONE[tone]}>{text}</Text>
    </Pressable>
  );
}

/** A switch named by its settings row, or by `accessibilityLabel` outside one. */
export function Toggle(props: SwitchProps) {
  const row = useContext(RowLabel);
  const label = props.accessibilityLabel ?? row;
  return <Switch {...props} {...(label === undefined ? {} : { accessibilityLabel: label })} />;
}

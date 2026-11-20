import { type Theme } from '@lelap/core';
import { createContext, useContext } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  Switch,
  type SwitchProps,
  Text,
} from 'react-native';

import { hint } from '../a11y';
import { useTheme } from '../theme';

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
 * The text kind of `Button`: a text-only button, such as “Open” at the end of a settings row. At least 48 points tall so a
 * finger finds it; `accessibilityLabel` names it when the text alone says too little.
 */
export function TextButton({
  text,
  onPress,
  disabled = false,
  tone = 'amber',
  accessibilityLabel,
  className = '',
  strong = false,
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  accessibilityLabel?: string;
  className?: string;
  /** Semibold, for the button that answers yes beside a “Not now”. */
  strong?: boolean;
}) {
  const row = useContext(RowLabel);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...hint(row)}
      className={`min-h-12 min-w-12 items-center justify-center ${disabled ? 'opacity-40' : ''} ${className}`}
    >
      <Text className={`${TONE[tone]}${strong ? ' font-semibold' : ''}`}>
        {text}
      </Text>
    </Pressable>
  );
}

// The web's switch is 40 by 20 in grey and teal: too small to hit and faint on the night theme.
// There it is 48 by 24, with a muted track (5:1 on night) that turns to the accent when on, and a
// thumb in the background's colour on a light theme. `activeThumbColor` is the web's own prop for
// the thumb when on.
const webSwitch = ({
  dark,
  colors,
}: Theme): Partial<SwitchProps> & { activeThumbColor?: string } =>
  Platform.OS === 'web'
    ? {
        style: { height: 24 },
        trackColor: { false: colors.muted, true: colors.amber },
        thumbColor: dark ? colors.paper : colors.night,
        activeThumbColor: dark ? colors.paper : colors.night,
      }
    : {};

/** A switch named by its settings row, or by `accessibilityLabel` outside one. */
export function Toggle(props: SwitchProps) {
  const row = useContext(RowLabel);
  const label = props.accessibilityLabel ?? row;
  const theme = useTheme();
  return (
    <Switch
      {...webSwitch(theme)}
      {...props}
      {...(label === undefined ? {} : { accessibilityLabel: label })}
    />
  );
}

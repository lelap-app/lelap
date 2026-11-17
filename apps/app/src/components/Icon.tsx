import type { ReactNode } from 'react';
import { Platform, Pressable } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

// One icon set for the whole app, drawn on a 24-unit grid in the design sketch's style: 1.8
// strokes with round caps, filled shapes only for play and pause.

type Draw = (color: string) => ReactNode;

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

const skip = (color: string, forward: boolean) => (
  <>
    <Path
      d={forward ? 'M20 12a8 8 0 1 1-2.5-5.8' : 'M4 12a8 8 0 1 0 2.5-5.8'}
      {...stroke(color)}
      strokeWidth={1.6}
    />
    <Path d={forward ? 'M20 3v4h-4' : 'M4 3v4h4'} {...stroke(color)} strokeWidth={1.6} />
    <SvgText x={12} y={15} textAnchor="middle" fontSize={7} fontWeight="600" fill={color}>
      30
    </SvgText>
  </>
);

const ICONS = {
  play: (c) => <Path d="M8 5v14l11-7z" fill={c} />,
  pause: (c) => (
    <>
      <Rect x={6} y={5} width={4} height={14} rx={1} fill={c} />
      <Rect x={14} y={5} width={4} height={14} rx={1} fill={c} />
    </>
  ),
  back30: (c) => skip(c, false),
  forward30: (c) => skip(c, true),
  previous: (c) => (
    <>
      <Path d="M6 5v14" {...stroke(c)} />
      <Path d="M19 6v12l-9-6z" fill={c} />
    </>
  ),
  next: (c) => (
    <>
      <Path d="M18 5v14" {...stroke(c)} />
      <Path d="M5 6v12l9-6z" fill={c} />
    </>
  ),
  down: (c) => <Path d="m6 9 6 6 6-6" {...stroke(c)} />,
  up: (c) => <Path d="m6 15 6-6 6 6" {...stroke(c)} />,
  back: (c) => <Path d="m15 6-6 6 6 6" {...stroke(c)} />,
  forward: (c) => <Path d="m9 6 6 6-6 6" {...stroke(c)} />,
  close: (c) => <Path d="M6 6l12 12M18 6 6 18" {...stroke(c)} />,
  settings: (c) => (
    <>
      <Path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" {...stroke(c)} />
      <Circle cx={16} cy={6} r={2} {...stroke(c)} />
      <Circle cx={10} cy={12} r={2} {...stroke(c)} />
      <Circle cx={18} cy={18} r={2} {...stroke(c)} />
    </>
  ),
  home: (c) => (
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" {...stroke(c)} />
  ),
  discover: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="m15.5 8.5-2 5-5 2 2-5z" {...stroke(c)} />
    </>
  ),
  search: (c) => (
    <>
      <Circle cx={11} cy={11} r={7} {...stroke(c)} />
      <Path d="m20 20-3.5-3.5" {...stroke(c)} />
    </>
  ),
  podcast: (c) => (
    <>
      <Circle cx={12} cy={11} r={2.5} {...stroke(c)} />
      <Path d="M12 14.5V21M7.8 15.5a6 6 0 1 1 8.4 0M5 18.3a9.5 9.5 0 1 1 14 0" {...stroke(c)} />
    </>
  ),
  library: (c) => (
    <>
      <Path d="M4 4h4v16H4zM10 4h4v16h-4z" {...stroke(c)} />
      <Path d="m16 5 3.5-1 2.5 15.5-3.5 1z" {...stroke(c)} />
    </>
  ),
  addons: (c) => (
    <>
      <Rect x={3} y={3} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Path d="M17.5 14v7M14 17.5h7" {...stroke(c)} />
    </>
  ),
  moon: (c) => <Path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" {...stroke(c)} />,
  bookmark: (c) => <Path d="M6 4h12v17l-6-4-6 4z" {...stroke(c)} />,
  bookmarkAdd: (c) => (
    <>
      <Path d="M6 4h12v17l-6-4-6 4z" {...stroke(c)} />
      <Path d="M12 8v6M9 11h6" {...stroke(c)} />
    </>
  ),
  chapters: (c) => (
    <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" {...stroke(c)} />
  ),
  speed: (c) => (
    <>
      <Path d="M4.5 17a8.5 8.5 0 1 1 15 0" {...stroke(c)} />
      <Path d="m12 13 4-5" {...stroke(c)} />
    </>
  ),
  check: (c) => (
    <>
      <Circle cx={12} cy={12} r={9} {...stroke(c)} />
      <Path d="m8 12 3 3 5-6" {...stroke(c)} />
    </>
  ),
  download: (c) => <Path d="M12 4v11M7 10l5 5 5-5M5 20h14" {...stroke(c)} />,
  cloud: (c) => (
    <Path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z" {...stroke(c)} />
  ),
  plane: (c) => (
    <Path
      d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
      fill={c}
    />
  ),
  plus: (c) => <Path d="M12 5v14M5 12h14" {...stroke(c)} />,
  lock: (c) => (
    <>
      <Rect x={5} y={11} width={14} height={10} rx={2} {...stroke(c)} />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" {...stroke(c)} />
    </>
  ),
  queue: (c) => <Path d="M4 6h16M4 12h10M4 18h10M18 14v6M15 17h6" {...stroke(c)} />,
} satisfies Record<string, Draw>;

export type IconName = keyof typeof ICONS;

// Decorative icons stay out of the screen reader; react-native-svg passes props to the DOM on the web.
const HIDDEN =
  Platform.OS === 'web'
    ? { 'aria-hidden': true }
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

/** An icon from the app's set. Decorative unless `label` is given. */
export function Icon({
  name,
  size = 24,
  color = '#f4f1ea',
  label,
}: {
  name: IconName;
  size?: number;
  color?: string;
  label?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...(label === undefined ? {} : { accessibilityLabel: label })}
      {...(label === undefined ? HIDDEN : {})}
    >
      {ICONS[name](color)}
    </Svg>
  );
}

/** Theme colours for icons, matching `tailwind.config.js`. */
export const COLORS = {
  night: '#0d0e11',
  raised: '#17191e',
  paper: '#f4f1ea',
  soft: '#c9c5bc',
  muted: '#8d8a83',
  line: '#33353b',
  amber: '#f5b041',
  ink: '#1a1305',
  danger: '#ff8a7a',
  ok: '#6bd49a',
} as const;

/** A 44-point icon button for headers and toolbars. */
export function IconButton({
  name,
  label,
  onPress,
  size = 24,
  color = COLORS.paper,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      {...(label === undefined ? {} : { accessibilityLabel: label })}
      className="h-11 w-11 items-center justify-center rounded-full active:bg-raised"
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}
